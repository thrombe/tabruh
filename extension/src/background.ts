import browser from 'webextension-polyfill';
import type { BackgroundRequest, DragData, GroupState, TabTree } from './types';

class StateManager {
    private groups: Map<string, GroupState> = new Map();
    private windowIdToGroupId: Map<number, string> = new Map();
    private ports: Set<browser.Runtime.Port> = new Set();

    constructor() {
        this.init();
    }

    private async init() {
        browser.runtime.onConnect.addListener((port) => this.handleNewConnection(port));
        this.attachListeners();
        await this.initializeStateForAllwindows();
    }

    private handleNewConnection(port: browser.Runtime.Port) {
        this.ports.add(port);
        port.onMessage.addListener((message: BackgroundRequest) => this.handleMessage(message, port));
        port.onDisconnect.addListener(() => {
            this.ports.delete(port);
        });
    }

    private handleMessage(message: BackgroundRequest, port: browser.Runtime.Port) {
        switch (message.type) {
            case 'GET_STATE_FOR_WINDOW':
                this.sendStateUpdateForWindow(message.payload.windowId, port);
                break;
            case 'GET_ALL_GROUPS':
                this.sendAllGroupsUpdate(port);
                break;
            case 'TOGGLE_COLLAPSE':
                this.toggleCollapse(message.payload.groupId, message.payload.nodeId);
                this.broadcastRenderAll();
                break;
            case 'HANDLE_DROP':
                this.handleDrop(message.payload.dragData, message.payload.targetTabId, message.payload.action, message.payload.targetGroupId);
                break;
            case 'FOCUS_TAB': this.focusTab(message.payload.tabId); break;
            case 'CLOSE_SUBTREE': this.closeSubtree(message.payload.tabId); break;
            case 'CLOSE_SINGLE_TAB': this.closeSingleTab(message.payload.tabId); break;
            case 'DUPLICATE_TAB_SMART': this.duplicateTabSmart(message.payload.tabId); break;
            case 'UNLOAD_TAB': browser.tabs.discard(message.payload.tabId); break;
            case 'UNLOAD_TREE': this.unloadTree(message.payload.tabId); break;
            case 'LOAD_TREE': this.loadTree(message.payload.tabId); break;
            case 'MOVE_SUBTREE_TO_NEW_WINDOW': this.moveSubtreeToNewWindow(message.payload.rootTabId); break;
            case 'CREATE_TAB': browser.tabs.create({ windowId: message.payload.windowId }); break;
            case 'CREATE_TAB_FROM_URL': this.createTabFromUrl(message.payload); break;
            case 'APPLY_PENDING_DATA': this.applyPendingData(message.payload.dragData, message.payload.targetGroupId); break;
            case 'RENAME_GROUP': this.renameGroup(message.payload.groupId, message.payload.newName); break;
            case 'CLOSE_GROUP': this.closeGroup(message.payload.groupId); break;
            case 'RESTORE_GROUP': this.restoreGroup(message.payload.groupId); break;
            case 'DELETE_GROUP': this.deleteGroup(message.payload.groupId); break;
        }
    }

    private getParent(tab: browser.Tabs.Tab, groupState: GroupState): number | undefined {
        if (tab.id === undefined) return undefined;
        const parentId = groupState.parentMap.get(tab.id);
        return parentId === -1 ? undefined : parentId;
    }

    private buildTabTreeForGroup(groupId: string) {
        const groupState = this.groups.get(groupId);
        if (!groupState) return;

        const nodes: TabTree = new Map();
        const rootIds: number[] = [];
        const tabsById = new Map<number, browser.Tabs.Tab>();

        for (const tab of groupState.tabs) {
            if (tab.id !== undefined) {
                tabsById.set(tab.id, tab);
            }
        }

        const sortedTabs = [...tabsById.values()].sort((a, b) => a.index - b.index);

        for (const tab of sortedTabs) {
            if (tab.id === undefined) continue;
            nodes.set(tab.id, {
                id: tab.id,
                title: tab.title ?? 'Untitled',
                url: tab.url ?? '',
                favIconUrl: tab.favIconUrl,
                parentId: this.getParent(tab, groupState),
                children: [],
            });
        }

        for (const node of nodes.values()) {
            const parentId = node.parentId;
            if (parentId !== undefined && nodes.has(parentId)) {
                nodes.get(parentId)!.children.push(node.id);
            } else {
                rootIds.push(node.id);
            }
        }

        groupState.tree = nodes;
        groupState.tabsById = tabsById;
        groupState.rootIds = rootIds;
    }

    private async updateGroupStateByWindowId(windowId: number) {
        const groupId = this.windowIdToGroupId.get(windowId);
        if (!groupId) return;
        const groupState = this.groups.get(groupId);
        if (!groupState) return;
        try {
            const tabs = await browser.tabs.query({ windowId });
            groupState.tabs = tabs;
            this.buildTabTreeForGroup(groupId);
        } catch (e) {
            console.error(`Could not update state for group associated with window ${windowId}:`, e);
            this.groups.delete(groupId);
            this.windowIdToGroupId.delete(windowId);
        }
    }

    private async initializeStateForAllwindows() {
        const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
        for (const win of windows) {
            if (win.id) {
                const groupId = crypto.randomUUID();
                const newGroup: GroupState = {
                    id: groupId,
                    name: `Window ${win.id}`,
                    windowId: win.id,
                    isClosed: false,
                    parentMap: new Map(),
                    collapsedNodes: new Set(),
                    tabs: [],
                    tree: new Map(),
                    tabsById: new Map(),
                    rootIds: [],
                    lastActiveTabId: (await browser.tabs.query({ windowId: win.id, active: true }))[0]?.id
                };
                this.groups.set(groupId, newGroup);
                this.windowIdToGroupId.set(win.id, groupId);
                await this.updateGroupStateByWindowId(win.id);

                // Post-initialization pass to establish natural parent relationships
                for (const tab of newGroup.tabs) {
                    if (tab.id && tab.openerTabId && newGroup.tabsById.has(tab.openerTabId)) {
                        newGroup.parentMap.set(tab.id, tab.openerTabId);
                    }
                }
                this.buildTabTreeForGroup(groupId);
            }
        }
    }

    private async updateAndBroadcast(windowId: number) {
        await this.updateGroupStateByWindowId(windowId);
        this.broadcastRenderAll();
    }

    private attachListeners() {
        browser.tabs.onCreated.addListener(async (tab) => {
            if (tab.windowId && tab.id) {
                const groupId = this.windowIdToGroupId.get(tab.windowId);
                if (groupId) {
                    const groupState = this.groups.get(groupId);
                    const tabsInWindow = await browser.tabs.query({ windowId: tab.windowId });
                    const openerExists = tab.openerTabId && tabsInWindow.some(t => t.id === tab.openerTabId);

                    if (groupState && tab.openerTabId && openerExists) {
                        if (!groupState.parentMap.has(tab.id)) {
                            groupState.parentMap.set(tab.id, tab.openerTabId);
                        }
                    }
                }
                await this.updateAndBroadcast(tab.windowId);
            }
        });

        browser.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
            if (!removeInfo.isWindowClosing && removeInfo.windowId) {
                await this.updateAndBroadcast(removeInfo.windowId);
            }
        });

        browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            if (tab.windowId) await this.updateAndBroadcast(tab.windowId);
        });

        browser.tabs.onMoved.addListener(async (tabId, moveInfo) => {
            await this.updateAndBroadcast(moveInfo.windowId);
        });

        browser.tabs.onAttached.addListener(async (tabId, attachInfo) => {
            await this.updateAndBroadcast(attachInfo.newWindowId);
        });

        browser.tabs.onDetached.addListener(async (tabId, detachInfo) => {
            await this.updateAndBroadcast(detachInfo.oldWindowId);
        });

        browser.tabs.onActivated.addListener(async (activeInfo) => {
            const groupId = this.windowIdToGroupId.get(activeInfo.windowId);
            if (groupId) {
                const group = this.groups.get(groupId);
                if (group) group.lastActiveTabId = activeInfo.tabId;
            }
            await this.updateAndBroadcast(activeInfo.windowId);
        });

        browser.windows.onCreated.addListener(async (win) => {
            if (win.id && win.type === 'normal') {
                const groupId = crypto.randomUUID();
                const newGroup: GroupState = {
                    id: groupId,
                    name: `Window ${win.id}`,
                    windowId: win.id,
                    isClosed: false,
                    parentMap: new Map(),
                    collapsedNodes: new Set(),
                    tabs: [],
                    tree: new Map(),
                    tabsById: new Map(),
                    rootIds: [],
                };
                this.groups.set(groupId, newGroup);
                this.windowIdToGroupId.set(win.id, groupId);
                await this.updateGroupStateByWindowId(win.id);
                this.broadcastRenderAll();
            }
        });

        browser.windows.onRemoved.addListener((windowId) => {
            const groupId = this.windowIdToGroupId.get(windowId);
            if (groupId && this.groups.has(groupId)) {
                const group = this.groups.get(groupId)!;
                group.isClosed = true;
                group.closedTimestamp = Date.now();
                delete group.windowId;
                this.windowIdToGroupId.delete(windowId);
                this.broadcastRenderAll();
            }
        });
    }

    private broadcastRenderAll() {
        for (const port of this.ports) {
            port.postMessage({ type: 'RENDER_ALL', payload: {} });
        }
    }

    private getGroupStateForUi(groupState: GroupState) {
        return {
            id: groupState.id,
            name: groupState.name,
            isClosed: groupState.isClosed,
            windowId: groupState.windowId,
            tree: groupState.tree,
            tabsById: groupState.tabsById,
            rootIds: groupState.rootIds,
            collapsedNodes: groupState.collapsedNodes,
        };
    }

    private sendStateUpdateForWindow(windowId: number, port: browser.Runtime.Port) {
        const groupId = this.windowIdToGroupId.get(windowId);
        if (!groupId) return;
        const groupState = this.groups.get(groupId);
        if (!groupState) return;

        try {
            port.postMessage({
                type: 'STATE_UPDATE',
                payload: { state: this.getGroupStateForUi(groupState) }
            });
        } catch (e) {
            console.error("Failed to send state update, port might be disconnected.", e);
            this.ports.delete(port);
        }
    }

    private sendAllGroupsUpdate(port: browser.Runtime.Port) {
        try {
            const allGroups = Array.from(this.groups.values()).map(this.getGroupStateForUi);
            port.postMessage({
                type: 'ALL_GROUPS_UPDATE',
                payload: { groups: allGroups }
            });
        } catch (e) {
            console.error("Failed to send all groups update, port might be disconnected.", e);
            this.ports.delete(port);
        }
    }

    private findGroupStateByTabId(tabId: number): GroupState | undefined {
        for (const group of this.groups.values()) {
            if (group.tabsById.has(tabId)) {
                return group;
            }
        }
        return undefined;
    }

    private getTabSubtreeIds(rootId: number, groupState: GroupState): number[] {
        const subtreeIds: number[] = [];
        const queue = [rootId];
        const visited = new Set<number>();
        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) continue;
            visited.add(currentId);
            subtreeIds.push(currentId);
            const node = groupState.tree.get(currentId);
            if (node) {
                queue.push(...node.children);
            }
        }
        return subtreeIds;
    }

    private async focusTab(tabId: number) {
        try {
            const tab = await browser.tabs.get(tabId);
            if (tab.windowId) {
                await browser.windows.update(tab.windowId, { focused: true });
            }
            await browser.tabs.update(tabId, { active: true });
        } catch (e) { console.error(`Could not focus tab ${tabId}:`, e); }
    }

    private async closeSubtree(tabId: number) {
        try {
            const groupState = this.findGroupStateByTabId(tabId);
            if (!groupState || groupState.isClosed) return;
            const idsToClose = this.getTabSubtreeIds(tabId, groupState);
            await browser.tabs.remove(idsToClose);
        } catch (e) { console.error(`Could not close tab subtree ${tabId}`, e); }
    }

    private async closeSingleTab(tabId: number) {
        try {
            const groupState = this.findGroupStateByTabId(tabId);
            if (!groupState || groupState.isClosed || !groupState.windowId) return;

            const tabToClose = groupState.tabsById.get(tabId);
            if (!tabToClose) return;

            const nodeToClose = groupState.tree.get(tabId);
            const childIds = nodeToClose?.children ?? [];
            const parentId = nodeToClose?.parentId;

            if (childIds.length > 0) {
                for (const childId of childIds) {
                    groupState.parentMap.set(childId, parentId ?? -1);
                }
                await browser.tabs.move(childIds, { index: tabToClose.index, windowId: groupState.windowId });
            }

            await browser.tabs.remove(tabId);
        } catch (e) {
            console.error(`Could not close single tab ${tabId}`, e);
        }
    }

    private toggleCollapse(groupId: string, nodeId: number) {
        const groupState = this.groups.get(groupId);
        if (!groupState) return;
        if (groupState.collapsedNodes.has(nodeId)) {
            groupState.collapsedNodes.delete(nodeId);
        } else {
            groupState.collapsedNodes.add(nodeId);
        }
    }

    private async unloadTree(tabId: number) {
        try {
            const groupState = this.findGroupStateByTabId(tabId);
            if (!groupState || groupState.isClosed) return;
            const idsToDiscard = this.getTabSubtreeIds(tabId, groupState);
            await browser.tabs.discard(idsToDiscard);
        } catch (e) { console.error(`Could not unload tree for tab ${tabId}:`, e); }
    }

    private async loadTree(tabId: number) {
        try {
            const groupState = this.findGroupStateByTabId(tabId);
            if (!groupState || groupState.isClosed) return;
            const idsToLoad = this.getTabSubtreeIds(tabId, groupState);
            for (const id of idsToLoad) {
                await browser.tabs.reload(id);
            }
        } catch (e) { console.error(`Could not load tree for tab ${tabId}:`, e); }
    }

    private async duplicateTabSmart(tabId: number) {
        try {
            const groupState = this.findGroupStateByTabId(tabId);
            if (!groupState || groupState.isClosed || !groupState.windowId) return;

            const originalTab = groupState.tabsById.get(tabId);
            if (!originalTab) return;

            const parentId = groupState.parentMap.get(tabId);
            const lastDescendantIndex = this.findLastDescendantIndexInFlatList(tabId, groupState);

            const newTab = await browser.tabs.create({
                windowId: groupState.windowId,
                index: lastDescendantIndex + 1,
                url: originalTab.url,
                active: false,
            });

            if (newTab.id && parentId) {
                groupState.parentMap.set(newTab.id, parentId);
            } else if (newTab.id) {
                groupState.parentMap.set(newTab.id, -1);
            }
        } catch (e) {
            console.error(`Could not duplicate tab ${tabId}:`, e);
        }
    }

    private async createTabFromUrl(payload: { url: string; windowId: number; index?: number; parentId?: number; }) {
        try {
            const { url, windowId, index, parentId } = payload;
            const groupId = this.windowIdToGroupId.get(windowId);
            const groupState = groupId ? this.groups.get(groupId) : undefined;
            if (!groupState) return;

            const newTab = await browser.tabs.create({
                url,
                windowId,
                index,
                active: false,
            });

            if (newTab.id && parentId) {
                groupState.parentMap.set(newTab.id, parentId);
            }
        } catch (e) {
            console.error('Failed to create tab from URL', e);
        }
    }

    private async moveSubtreeToNewWindow(rootTabId: number) {
        try {
            const sourceGroup = this.findGroupStateByTabId(rootTabId);
            if (!sourceGroup || sourceGroup.isClosed || !sourceGroup.windowId) return;

            const movedTabIds = this.getTabSubtreeIds(rootTabId, sourceGroup);
            if (movedTabIds.length === 0) return;

            const newWindow = await browser.windows.create({ tabId: rootTabId });
            if (!newWindow.id) return;

            const otherTabIds = movedTabIds.filter(id => id !== rootTabId);
            if (otherTabIds.length > 0) {
                await browser.tabs.move(otherTabIds, { windowId: newWindow.id, index: -1 });
            }

            const newGroupId = this.windowIdToGroupId.get(newWindow.id);
            const newGroup = newGroupId ? this.groups.get(newGroupId) : undefined;
            if (!newGroup) return;

            for (const tabId of movedTabIds) {
                if (sourceGroup.parentMap.has(tabId)) {
                    newGroup.parentMap.set(tabId, sourceGroup.parentMap.get(tabId)!);
                    sourceGroup.parentMap.delete(tabId);
                }
                if (sourceGroup.collapsedNodes.has(tabId)) {
                    newGroup.collapsedNodes.add(tabId);
                    sourceGroup.collapsedNodes.delete(tabId);
                }
            }
            newGroup.parentMap.set(rootTabId, -1);

            await this.updateGroupStateByWindowId(newWindow.id);
            if (sourceGroup.windowId) {
                await this.updateGroupStateByWindowId(sourceGroup.windowId);
            }
            this.broadcastRenderAll();
        } catch (e) {
            console.error('Failed to move subtree to new window:', e);
        }
    }

    private applyPendingData(dragData: DragData, targetGroupId: string) {
        const targetGroup = this.groups.get(targetGroupId);
        const sourceGroup = this.groups.get(dragData.sourceGroupId);
        if (!targetGroup || !sourceGroup) return;

        for (const [childId, parentId] of Object.entries(dragData.parentMapSnapshot)) {
            if (parentId !== undefined && parentId !== null) {
                targetGroup.parentMap.set(Number(childId), parentId);
            }
        }
        for (const id of dragData.collapsed) {
            targetGroup.collapsedNodes.add(id);
        }
        for (const id of dragData.movedTabIds) {
            sourceGroup.collapsedNodes.delete(id);
        }
    }

    private findLastDescendantIndexInFlatList(startNodeId: number, groupState: GroupState): number {
        const startTab = groupState.tabsById.get(startNodeId);
        if (!startTab) throw new Error(`Tab ${startNodeId} not found.`);

        let maxIndex = startTab.index;
        const subtreeIds = this.getTabSubtreeIds(startNodeId, groupState);
        for (const id of subtreeIds) {
            const tab = groupState.tabsById.get(id);
            if (tab && tab.index > maxIndex) maxIndex = tab.index;
        }
        return maxIndex;
    }

    private async handleDrop(dragData: DragData, targetTabId: number, action: string, targetGroupId: string) {
        const targetGroup = this.groups.get(targetGroupId);
        const sourceGroup = this.groups.get(dragData.sourceGroupId);
        if (!targetGroup || !sourceGroup || targetGroup.isClosed || !targetGroup.windowId) return;

        try {
            let index: number;
            let newParentId: number | undefined | null = null;

            const draggedTab = sourceGroup.tabsById.get(dragData.draggedTabId);
            if (!draggedTab) return;
            const isMovingDown = dragData.sourceGroupId === targetGroupId && draggedTab.index < (targetGroup.tabsById.get(targetTabId)?.index ?? Infinity);

            switch (action) {
                case 'above': {
                    const targetTab = targetGroup.tabsById.get(targetTabId);
                    if (!targetTab) return;
                    index = targetTab.index;
                    newParentId = targetGroup.tree.get(targetTabId)?.parentId;
                    break;
                }
                case 'below': {
                    index = this.findLastDescendantIndexInFlatList(targetTabId, targetGroup) + 1;
                    newParentId = targetGroup.tree.get(targetTabId)?.parentId;
                    break;
                }
                case 'root': {
                    index = -1;
                    newParentId = -1;
                    break;
                }
                case 'inside':
                default: {
                    index = this.findLastDescendantIndexInFlatList(targetTabId, targetGroup) + 1;
                    newParentId = targetTabId;
                    break;
                }
            }

            if (isMovingDown) {
                index--;
            }

            if (newParentId === null) {
                // Keep original parent
            } else if (newParentId === -1 || newParentId === undefined) {
                targetGroup.parentMap.set(dragData.draggedTabId, -1);
            } else {
                targetGroup.parentMap.set(dragData.draggedTabId, newParentId);
            }

            await browser.tabs.move(dragData.movedTabIds, { index, windowId: targetGroup.windowId });

            await this.updateGroupStateByWindowId(targetGroup.windowId);
            if (sourceGroup.windowId && sourceGroup.windowId !== targetGroup.windowId) {
                await this.updateGroupStateByWindowId(sourceGroup.windowId);
            }
            this.broadcastRenderAll();
        } catch (e) {
            console.error('Failed to handle drop:', e);
        }
    }

    private renameGroup(groupId: string, newName: string) {
        const group = this.groups.get(groupId);
        if (group) {
            group.name = newName;
            this.broadcastRenderAll();
        }
    }

    private async closeGroup(groupId: string) {
        const group = this.groups.get(groupId);
        if (group && group.windowId && !group.isClosed) {
            try {
                await browser.windows.remove(group.windowId);
            } catch (e) {
                console.error(`Failed to close window for group ${groupId}`, e);
            }
        }
    }

    private async deleteGroup(groupId: string) {
        const group = this.groups.get(groupId);
        if (group) {
            const { windowId, isClosed } = group;

            this.groups.delete(groupId);
            if (windowId) {
                this.windowIdToGroupId.delete(windowId);
            }

            for (const port of this.ports) {
                port.postMessage({ type: 'GROUP_REMOVED', payload: { groupId } });
            }

            if (windowId && !isClosed) {
                try {
                    await browser.windows.remove(windowId);
                } catch (e) {
                    console.warn(`Could not remove window for group ${groupId}, it might have been closed already.`, e);
                }
            }
        }
    }

    private async restoreGroup(groupId: string) {
        const group = this.groups.get(groupId);
        if (!group || !group.isClosed) return;

        const tabsToCreate = [...group.tabsById.values()].sort((a, b) => a.index - b.index);
        if (tabsToCreate.length === 0) return;

        const activeTabInfo = group.tabsById.get(group.lastActiveTabId ?? -1) ?? tabsToCreate[0];

        try {
            const newWindow = await browser.windows.create({ url: activeTabInfo.url, state: 'maximized' });
            if (!newWindow.id || !newWindow.tabs || newWindow.tabs.length === 0) return;

            const newWindowId = newWindow.id;
            const firstNewTabId = newWindow.tabs[0].id!;

            const oldIdToNewIdMap = new Map<number, number>();
            oldIdToNewIdMap.set(activeTabInfo.id!, firstNewTabId);

            const allNewTabIdsToDiscard = [];

            for (const tabInfo of tabsToCreate) {
                if (tabInfo.id === activeTabInfo.id) continue;
                const newTab = await browser.tabs.create({
                    windowId: newWindowId,
                    url: tabInfo.url,
                    active: false,
                });
                if (newTab.id) {
                    oldIdToNewIdMap.set(tabInfo.id!, newTab.id);
                    allNewTabIdsToDiscard.push(newTab.id);
                }
            }

            const newParentMap = new Map<number, number>();
            for (const [oldChildId, oldParentId] of group.parentMap.entries()) {
                const newChildId = oldIdToNewIdMap.get(oldChildId);
                const newParentId = oldParentId === -1 ? -1 : oldIdToNewIdMap.get(oldParentId);
                if (newChildId !== undefined && newParentId !== undefined) {
                    newParentMap.set(newChildId, newParentId);
                }
            }

            group.isClosed = false;
            group.windowId = newWindowId;
            delete group.closedTimestamp;
            group.parentMap = newParentMap;
            this.windowIdToGroupId.set(newWindowId, groupId);

            await this.updateGroupStateByWindowId(newWindowId);
            group.lastActiveTabId = firstNewTabId;

            if (allNewTabIdsToDiscard.length > 0) {
                await browser.tabs.discard(allNewTabIdsToDiscard);
            }

            this.broadcastRenderAll();

        } catch (e) { console.error(`Failed to restore group ${groupId}:`, e) }
    }
}

async function main() {
    console.log("tabruh loaded");

    let state = new StateManager();

    browser.runtime.onInstalled.addListener(() => {
        browser.menus.create({
            id: "open-overview",
            title: "Overview Page",
            contexts: ["browser_action"],
        })
    });
    browser.menus.onClicked.addListener((info, tab) => {
        switch (info.menuItemId) {
            case "open-overview": {
                browser.tabs.create({
                    url: browser.runtime.getURL("overview.html"),
                });
            } break;
            default:
                console.error("unknown menu item id " + info.menuItemId);
        }
    });

    browser.browserAction.onClicked.addListener(async (tab, info) => {
        await browser.sidebarAction.toggle();
    });

    browser.tabs.onActivated.addListener(async tab => {
        // console.log("tab activated");
        // console.log(tab);
        // console.log(await browser.windows.get(tab.windowId));
        // console.log(await browser.tabs.get(tab.previousTabId ?? 0));
        // console.log(await browser.tabs.get(tab.tabId));

        // console.log(await browser.tabs.update(tab.tabId, { active: true }));
        // console.log(await browser.tabs.discard(tab.previousTabId ?? 0));
    });
    browser.tabs.onCreated.addListener(async tab => {
        // console.log("tab created");
        // console.log(tab);
        // console.log(await browser.tabs.get(tab.openerTabId ?? 0));
    });
    browser.tabs.onUpdated.addListener(async id => {
        // let tab = await browser.tabs.get(id);
        // console.log("tab updated ", id, tab.status);
        // console.log(tab);
        // if (tab.status == "complete" && !tab.discarded && !tab.active) {
        //     console.log("switch to " + tab.id);
        //     console.log(await browser.tabs.update(tab.id, { active: true }));

        //     if (tab.openerTabId) {
        //         console.log("discard " + tab.openerTabId);
        //         await browser.tabs.discard(tab.openerTabId);
        //     }
        // }
    });

    // Monitor completed navigation events and update
    // stats accordingly.
    browser.webNavigation.onCommitted.addListener(async (evt) => {
        // if (evt.frameId !== 0) {
        //     return;
        // }
        // console.log(await browser.tabs.query({ currentWindow: true }));

        // console.log("new tab?")

        // let transitionType = evt.transitionType;
    });

    browser.webNavigation.onCompleted.addListener(evt => {
        // Filter out any sub-frame related navigation event
        // if (evt.frameId !== 0) {
        //     return;
        // }

        // const url = new URL(evt.url);
        // console.log(url);
    }, {
        url: [{ schemes: ["http", "https"] }]
    });
}

main()
