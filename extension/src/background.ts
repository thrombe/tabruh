import browser from 'webextension-polyfill';
import type { BackgroundRequest, DragData, TabNode, TabTree, WindowState } from './types';

class StateManager {
    private state: Map<number, WindowState> = new Map();
    private ports: Map<number, browser.Runtime.Port[]> = new Map();

    constructor() {
        this.init();
    }

    private async init() {
        browser.runtime.onConnect.addListener((port) => this.handleNewConnection(port));
        this.attachTabListeners();
        await this.initializeStateForAllwindows();
    }

    private handleNewConnection(port: browser.Runtime.Port) {
        const windowId = port.sender?.tab?.windowId;
        if (!windowId) {
            console.error('Connection from unknown window, disconnecting.');
            port.disconnect();
            return;
        }

        const windowPorts = this.ports.get(windowId) || [];
        windowPorts.push(port);
        this.ports.set(windowId, windowPorts);

        port.onMessage.addListener((message: BackgroundRequest) => this.handleMessage(message, port));
        port.onDisconnect.addListener(() => {
            const updatedPorts = (this.ports.get(windowId) || []).filter(p => p !== port);
            if (updatedPorts.length > 0) {
                this.ports.set(windowId, updatedPorts);
            } else {
                this.ports.delete(windowId);
            }
        });

        this.sendStateUpdate(windowId);
    }

    private handleMessage(message: BackgroundRequest, port: browser.Runtime.Port) {
        const windowId = message.payload.windowId ?? port.sender?.tab?.windowId;
        if (!windowId) return;

        switch (message.type) {
            case 'GET_STATE':
                this.sendStateUpdate(windowId);
                break;
            case 'TOGGLE_COLLAPSE':
                this.toggleCollapse(windowId, message.payload.nodeId);
                this.sendStateUpdate(windowId);
                break;
            case 'HANDLE_DROP':
                this.handleDrop(message.payload.dragData, message.payload.targetTabId, message.payload.action, message.payload.windowId);
                break;
            case 'FOCUS_TAB': this.focusTab(message.payload.tabId); break;
            case 'CLOSE_TAB': this.closeTab(message.payload.tabId); break;
            case 'DUPLICATE_TAB': browser.tabs.duplicate(message.payload.tabId); break;
            case 'UNLOAD_TAB': browser.tabs.discard(message.payload.tabId); break;
            case 'UNLOAD_TREE': this.unloadTree(message.payload.tabId); break;
            case 'COPY_URL': this.copyUrl(message.payload.tabId); break;
            case 'MOVE_SUBTREE_TO_NEW_WINDOW': this.moveSubtreeToNewWindow(message.payload.rootTabId); break;
            case 'CREATE_TAB': browser.tabs.create({ windowId: message.payload.windowId }); break;
            case 'APPLY_PENDING_DATA': this.applyPendingData(message.payload.dragData, message.payload.windowId); break;
        }
    }

    private getParent(tab: browser.Tabs.Tab, windowId: number): number | undefined {
        const windowState = this.state.get(windowId);
        if (!windowState || tab.id === undefined) return undefined;

        const parent = windowState.parentMap.get(tab.id);
        if (parent === -1) return undefined;
        if (parent === undefined) return tab.openerTabId;
        return parent;
    }

    private buildTabTreeForWindow(windowId: number) {
        const windowState = this.state.get(windowId);
        if (!windowState) return;

        const nodes: TabTree = new Map();
        const rootIds: number[] = [];
        const tabsById = new Map<number, browser.Tabs.Tab>();

        for (const tab of windowState.tabs) {
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
                parentId: this.getParent(tab, windowId),
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

        windowState.tree = nodes;
        windowState.tabsById = tabsById;
        windowState.rootIds = rootIds;
    }

    private async updateWindowState(windowId: number) {
        const tabs = await browser.tabs.query({ windowId });
        const windowState = this.state.get(windowId);
        if (windowState) {
            windowState.tabs = tabs;
            this.buildTabTreeForWindow(windowId);
        } else {
            this.state.set(windowId, {
                parentMap: new Map(),
                collapsedNodes: new Set(),
                tabs,
                tree: new Map(),
                tabsById: new Map(),
                rootIds: [],
            });
            this.buildTabTreeForWindow(windowId);
        }
    }

    private async initializeStateForAllwindows() {
        const windows = await browser.windows.getAll({ populate: true });
        for (const win of windows) {
            if (win.id && win.tabs) {
                await this.updateWindowState(win.id);
            }
        }
    }

    private attachTabListeners() {
        const handler = async (tabId: number | browser.Tabs.Tab, removeInfo?: { windowId: number, isWindowClosing: boolean }) => {
            const allWindows = await browser.windows.getAll();
            for (const win of allWindows) {
                if (win.id) {
                    await this.updateWindowState(win.id);
                    this.broadcastRender(win.id);
                }
            }
        };

        browser.tabs.onCreated.addListener(handler);
        browser.tabs.onRemoved.addListener(handler);
        browser.tabs.onUpdated.addListener(handler);
        browser.tabs.onMoved.addListener(handler);
        browser.tabs.onAttached.addListener(handler);
        browser.tabs.onDetached.addListener(handler);
        browser.windows.onCreated.addListener(async (win) => {
            if (win.id) await this.updateWindowState(win.id);
        });
        browser.windows.onRemoved.addListener((windowId) => {
            this.state.delete(windowId);
            this.ports.delete(windowId);
        });
    }

    private broadcastRender(windowId: number) {
        const windowPorts = this.ports.get(windowId);
        if (windowPorts) {
            windowPorts.forEach(port => port.postMessage({ type: 'RENDER', payload: { windowId } }));
        }
    }

    private sendStateUpdate(windowId: number) {
        const windowState = this.state.get(windowId);
        if (!windowState) return;

        const windowPorts = this.ports.get(windowId);
        if (windowPorts) {
            windowPorts.forEach(port => port.postMessage({
                type: 'STATE_UPDATE',
                payload: {
                    state: {
                        tree: windowState.tree,
                        tabsById: windowState.tabsById,
                        rootIds: windowState.rootIds,
                        collapsedNodes: windowState.collapsedNodes,
                    }
                }
            }));
        }
    }

    private getTabSubtreeIds(rootId: number, windowId: number): number[] {
        const windowState = this.state.get(windowId);
        if (!windowState) return [];
        const subtreeIds: number[] = [];
        const queue = [rootId];
        const visited = new Set<number>();
        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) continue;
            visited.add(currentId);
            subtreeIds.push(currentId);
            const node = windowState.tree.get(currentId);
            if (node) {
                queue.push(...node.children);
            }
        }
        return subtreeIds;
    }

    private async focusTab(tabId: number) {
        try {
            const tab = await browser.tabs.get(tabId);
            if (!tab.discarded) {
                if (tab.windowId) {
                    await browser.windows.update(tab.windowId, { focused: true });
                }
                await browser.tabs.update(tabId, { active: true });
            } else {
                await browser.tabs.update(tabId, { active: true });
            }
        } catch (e) { console.error(`Could not focus tab ${tabId}:`, e); }
    }

    private async closeTab(tabId: number) {
        try {
            const tab = await browser.tabs.get(tabId);
            if (!tab.windowId) return;
            const idsToClose = this.getTabSubtreeIds(tabId, tab.windowId);
            await browser.tabs.remove(idsToClose);
        } catch (e) { console.error(`Could not close tab ${tabId}`, e); }
    }

    private toggleCollapse(windowId: number, nodeId: number) {
        const windowState = this.state.get(windowId);
        if (!windowState) return;
        if (windowState.collapsedNodes.has(nodeId)) {
            windowState.collapsedNodes.delete(nodeId);
        } else {
            windowState.collapsedNodes.add(nodeId);
        }
    }

    private async unloadTree(tabId: number) {
        try {
            const tab = await browser.tabs.get(tabId);
            if (!tab.windowId) return;
            const idsToDiscard = this.getTabSubtreeIds(tabId, tab.windowId);
            await browser.tabs.discard(idsToDiscard);
        } catch (e) { console.error(`Could not unload tree for tab ${tabId}:`, e); }
    }

    private async copyUrl(tabId: number) {
        try {
            const tab = await browser.tabs.get(tabId);
            if (tab.url) {
                await browser.scripting.executeScript({
                    target: { tabId },
                    func: (urlToCopy: string) => {
                        navigator.clipboard.writeText(urlToCopy);
                    },
                    args: [tab.url],
                });
            }
        } catch (e) { console.error('Failed to copy URL:', e); }
    }

    private async moveSubtreeToNewWindow(rootTabId: number) {
        try {
            const tab = await browser.tabs.get(rootTabId);
            const sourceWindowId = tab.windowId;
            if (!sourceWindowId) return;

            const movedTabIds = this.getTabSubtreeIds(rootTabId, sourceWindowId);
            if (movedTabIds.length === 0) return;

            const newWindow = await browser.windows.create({ tabId: rootTabId });
            const otherTabIds = movedTabIds.filter(id => id !== rootTabId);
            if (otherTabIds.length > 0) {
                await browser.tabs.move(otherTabIds, { windowId: newWindow.id, index: -1 });
            }

            const sourceState = this.state.get(sourceWindowId);
            if (!sourceState || !newWindow.id) return;
            const newWindowState = this.state.get(newWindow.id) ?? {
                parentMap: new Map(), collapsedNodes: new Set(), tabs: [], tree: new Map(), tabsById: new Map(), rootIds: []
            };
            this.state.set(newWindow.id, newWindowState);

            for (const id of movedTabIds) {
                if (sourceState.parentMap.has(id)) {
                    newWindowState.parentMap.set(id, sourceState.parentMap.get(id)!);
                    sourceState.parentMap.delete(id);
                }
                if (sourceState.collapsedNodes.has(id)) {
                    newWindowState.collapsedNodes.add(id);
                    sourceState.collapsedNodes.delete(id);
                }
            }
        } catch (e) { console.error('Failed to move subtree to new window:', e); }
    }

    private applyPendingData(dragData: DragData, windowId: number) {
        const windowState = this.state.get(windowId);
        if (!windowState) return;

        for (const [childId, parentId] of Object.entries(dragData.parentMapSnapshot)) {
            if (parentId !== undefined && parentId !== null) {
                windowState.parentMap.set(Number(childId), parentId);
            }
        }
        for (const id of dragData.collapsed) {
            windowState.collapsedNodes.add(id);
        }
        for (const id of dragData.movedTabIds) {
            const sourceState = this.state.get(dragData.sourceWindowId);
            sourceState?.collapsedNodes.delete(id);
        }
    }

    private findLastDescendantIndexInFlatList(startNodeId: number, windowId: number): number {
        const windowState = this.state.get(windowId);
        const startTab = windowState?.tabsById.get(startNodeId);
        if (!windowState || !startTab) throw new Error(`Tab ${startNodeId} not found.`);

        let maxIndex = startTab.index;
        const subtreeIds = this.getTabSubtreeIds(startNodeId, windowId);
        for (const id of subtreeIds) {
            const tab = windowState.tabsById.get(id);
            if (tab && tab.index > maxIndex) maxIndex = tab.index;
        }
        return maxIndex;
    }

    private async handleDrop(dragData: DragData, targetTabId: number, action: string, windowId: number) {
        const targetState = this.state.get(windowId);
        if (!targetState) return;

        try {
            let index: number;
            let newParentId: number | undefined | null = null;

            switch (action) {
                case 'above': {
                    const targetTab = targetState.tabsById.get(targetTabId);
                    if (!targetTab) return;
                    index = targetTab.index;
                    newParentId = targetState.tree.get(targetTabId)?.parentId;
                    break;
                }
                case 'below': {
                    index = this.findLastDescendantIndexInFlatList(targetTabId, windowId) + 1;
                    newParentId = targetState.tree.get(targetTabId)?.parentId;
                    break;
                }
                case 'root': {
                    index = -1;
                    newParentId = -1;
                    break;
                }
                case 'inside':
                default: {
                    index = this.findLastDescendantIndexInFlatList(targetTabId, windowId) + 1;
                    newParentId = targetTabId;
                    break;
                }
            }

            if (newParentId === null) {
                // Do nothing, parent stays as is
            } else if (newParentId === -1 || newParentId === undefined) {
                targetState.parentMap.set(dragData.draggedTabId, -1);
            } else {
                targetState.parentMap.set(dragData.draggedTabId, newParentId);
            }

            await browser.tabs.move(dragData.movedTabIds, { index, windowId });
        } catch (e) {
            console.error('Failed to handle drop:', e);
        }
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
        if (info.menuItemId === "open-overview") {
            browser.tabs.create({
                url: browser.runtime.getURL("overview.html"),
            });
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
