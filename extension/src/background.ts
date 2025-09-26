import browser from 'webextension-polyfill';
import type {
    BackgroundRequest,
    BackgroundResponse,
    DragData,
    Node,
    NodeTree,
    StateManagerEvent,
    TabId,
    UiNode,
    UiStateForRender,
    BruhWindow,
    WindowId,
    BruhId,
} from './types'; import * as utils from './utils';

class App {
    ports: Set<browser.Runtime.Port> = new Set();
    eventChannel: utils.Channel<StateManagerEvent> = new utils.Channel();

    bruhid: BruhId = 1;
    tree: NodeTree = new Map();
    windows: Map<WindowId, BruhWindow> = new Map();
    tab_id_map: Map<TabId, BruhId> = new Map();

    static async init() {
        let self = new App();
        self.tree = await self.get_tree();
        return self;
    }

    async attach_listeners() {
        browser.runtime.onConnect.addListener((port) => {
            this.ports.add(port);

            port.onMessage.addListener(async (message) => {
                await this.eventChannel.send({
                    type: 'portMessage',
                    payload: { message: message as BackgroundRequest, port }
                });
            });
            port.onDisconnect.addListener(() => {
                this.ports.delete(port);
            });
        });

        browser.tabs.onCreated.addListener(async (tab) => {
            let _ = await this.eventChannel.send({ type: 'tabCreated', payload: tab });
        });

        browser.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
            let _ = await this.eventChannel.send({ type: 'tabRemoved', payload: { tabId, removeInfo } });
        });

        browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            let _ = await this.eventChannel.send({ type: 'tabUpdated', payload: { tabId, changeInfo, tab } });
        });

        browser.tabs.onMoved.addListener(async (tabId, moveInfo) => {
            let _ = await this.eventChannel.send({ type: 'tabMoved', payload: { tabId, moveInfo } });
        });

        browser.tabs.onAttached.addListener(async (tabId, attachInfo) => {
            let _ = await this.eventChannel.send({ type: 'tabAttached', payload: { tabId, attachInfo } });
        });

        browser.tabs.onDetached.addListener(async (tabId, detachInfo) => {
            let _ = await this.eventChannel.send({ type: 'tabDetached', payload: { tabId, detachInfo } });
        });

        browser.tabs.onActivated.addListener(async (activeInfo) => {
            let _ = await this.eventChannel.send({ type: 'tabActivated', payload: activeInfo });
        });

        browser.windows.onCreated.addListener(async (win) => {
            let _ = await this.eventChannel.send({ type: 'windowCreated', payload: win });
        });

        browser.windows.onRemoved.addListener(async (windowId) => {
            let _ = await this.eventChannel.send({ type: 'windowRemoved', payload: windowId });
        });
    }

    get_tab_id(tid: TabId): BruhId;
    get_tab_id(tid: TabId | undefined): BruhId | undefined;
    get_tab_id(tid: TabId | undefined): BruhId | undefined {
        if (tid === undefined) return undefined;
        let id = this.tab_id_map.get(tid);
        if (id == undefined) {
            const bid = this.bruhid++;
            this.tab_id_map.set(tid, bid);
            return bid;
        } else {
            return id;
        }
    }

    get_window_id(wid: WindowId): BruhId;
    get_window_id(wid: WindowId | undefined): BruhId | undefined;
    get_window_id(wid: WindowId | undefined): BruhId | undefined {
        if (wid === undefined) return undefined;
        let w = this.windows.get(wid);
        if (w) return w.id;
        const bid = this.bruhid++;
        return bid;
    }

    async get_tree() {
        let tree: NodeTree = new Map();
        let creationTime = Date.now();
        let windows = await browser.windows.getAll({ windowTypes: ["normal"], populate: true });
        for (let w of windows) {
            const id = this.get_window_id(w.id);
            if (!id) continue;
            const wid = w.id!;
            this.windows.set(wid, {
                id: id,
                wid: wid,
                ctime: creationTime++,
                tabs: w.tabs ?? [],
            });
            tree.set(id, {
                type: "window",
                id: id,
                title: `Window ${id}`,
                wid: wid,
            });
        }

        for (const win of windows) {
            for (const t of win.tabs ?? []) {
                let _ = this.get_tab_id(t.id);
            }
        }

        for (const win of windows) {
            for (const t of win.tabs ?? []) {
                const id = this.get_tab_id(t.id);
                if (!id || !this.get_window_id(t.windowId)) continue;
                this._set_tab(id, t, "opener", tree);
            }
        }

        return tree;
    }

    _set_tab(id: BruhId, tab: browser.Tabs.Tab, parent: "window" | "old" | "opener", tree: NodeTree | undefined = undefined) {
        const targetTree = tree ?? this.tree;
        const old = this.tree.get(id) as (Node & { type: "tab" | "group" }) | undefined;

        const w = this.windows.get(tab.windowId!)!;
        let pid: BruhId;
        if (parent === "old" && old) {
            pid = old.parentId;
        } else if (parent === "window") {
            pid = w.id;
        } else { // opener
            const openerBruhId = this.get_tab_id(tab.openerTabId);
            const openerNode = openerBruhId ? this.tree.get(openerBruhId) : undefined;
            const openerTab = w.tabs.find(t => t.id === tab.openerTabId);
            pid = openerBruhId && openerNode && openerTab ? openerBruhId : w.id;
        }

        this.tab_id_map.set(tab.id!, id);
        const isGroup = this._isGroupTab(tab);

        targetTree.set(id, {
            type: isGroup ? "group" : "tab",
            id: id,
            tid: tab.id!,
            url: tab.url!,
            title: tab.title ?? "Untitled",
            favIconUrl: tab.favIconUrl,
            parentId: pid,
            collapsed: old?.collapsed ?? false,
        } as Node);

        return targetTree.get(id)! as Node & { type: "group" | "tab" };
    }

    private _isGroupTab(tab: browser.Tabs.Tab): boolean {
        try {
            if (!tab.url) return false;
            const url = new URL(tab.url);
            return url.protocol === 'moz-extension:' &&
                url.pathname.endsWith('/overview.html') &&
                url.searchParams.has('view') &&
                url.searchParams.get('view') === 'group';
        } catch (e) {
            return false;
        }
    }

    private _getSubtree(rootId: BruhId): BruhId[] {
        const subtree: BruhId[] = [];
        const queue: BruhId[] = [rootId];
        const visited = new Set<BruhId>();

        const childrenMap = this._getChildrenMap();

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) continue;
            visited.add(currentId);
            subtree.push(currentId);

            const children = childrenMap.get(currentId) || [];
            for (const childId of children) {
                queue.push(childId);
            }
        }
        return subtree;
    }

    private _getChildrenMap(): Map<BruhId, BruhId[]> {
        const map = new Map<BruhId, BruhId[]>();
        for (const [_, w] of this.windows) {
            for (const tid of w.tabs) {
                const tbid = this.get_tab_id(tid.id);
                if (!tbid) continue;

                const node = this.tree.get(tbid);
                if (!node || node.type === 'window') continue;

                if (!map.has(node.parentId)) {
                    map.set(node.parentId, []);
                }
                map.get(node.parentId)!.push(node.id);
            }
        }
        return map;
    }

    private _getOrderedTabList(windowId: WindowId): BruhId[] {
        const win = this.windows.get(windowId);
        if (!win) return [];

        return win.tabs.map(t => this.get_tab_id(t.id!));
    }


    private _buildUiStateForRender(windowId: WindowId, rootNodeId?: BruhId): UiStateForRender | null {
        const win = this.windows.get(windowId);
        if (!win) return null;

        const childrenMap = this._getChildrenMap();
        const rootIds: BruhId[] = [];
        const uiTree: Map<BruhId, UiNode> = new Map();
        const tabsById = new Map(win.tabs.map(t => [t.id!, t]));

        const nodesToRender = win.tabs.map(t => t.id).filter(id => id !== undefined);

        for (const nodeId of nodesToRender) {
            const node = this.tree.get(this.get_tab_id(nodeId));
            if (!node || node.type === 'window') continue;

            const tab = tabsById.get(node.tid!);
            if (!tab) continue;

            uiTree.set(node.id, {
                id: node.id,
                tid: node.tid,
                tab_index: tab.index,
                title: node.title,
                url: node.url,
                favIconUrl: node.favIconUrl,
                isGroup: node.type === 'group',
                isDiscarded: tab.discarded ?? false,
                isActive: tab.active,
                isCollapsed: node.collapsed,
                children: childrenMap.get(node.id) || [],
            });

            if (rootNodeId) {
                if (node.parentId === rootNodeId) {
                    rootIds.push(node.id);
                }
            } else {
                if (node.parentId === win.id) {
                    rootIds.push(node.id);
                }
            }
        }

        const rootNode = rootNodeId ? this.tree.get(rootNodeId) : this.tree.get(win.id);

        return {
            id: rootNodeId || win.id,
            windowId: win.wid,
            name: rootNode?.title || '',
            isClosed: false, // This model doesn't handle closed windows yet
            creationTimestamp: win.ctime,
            tree: uiTree,
            tabsById,
            rootIds,
        };
    }

    private _post(port: browser.Runtime.Port, message: BackgroundResponse) {
        try {
            port.postMessage(message);
        } catch (e) {
            this.ports.delete(port);
        }
    }

    private _broadcast(message: BackgroundResponse) {
        for (const port of this.ports) {
            this._post(port, message);
        }
    }

    private _broadcastUpdates(event: StateManagerEvent) {
        switch (event.type) {
            case 'tabCreated':
            case 'tabRemoved':
            case 'tabUpdated':
            case 'tabMoved':
            case 'tabAttached':
            case 'tabDetached':
            case 'tabActivated':
            case 'windowCreated':
            case 'windowRemoved':
                this._broadcast({ type: 'RENDER_ALL', payload: {} });
                break;

            case 'portMessage':
                const message = event.payload.message;
                switch (message.type) {
                    case 'GET_STATE_FOR_WINDOW':
                    case 'GET_STATE_FOR_GROUP_VIEW':
                    case 'GET_ALL_WINDOW_STATES':
                        break;

                    case 'TOGGLE_COLLAPSE':
                    case 'HANDLE_DROP':
                    case 'CLOSE_SUBTREE':
                    case 'CLOSE_SINGLE_TAB':
                    case 'DUPLICATE_TAB_SMART':
                    case 'UNLOAD_TAB':
                    case 'UNLOAD_TREE':
                    case 'LOAD_TREE':
                    case 'MOVE_SUBTREE_TO_NEW_WINDOW':
                    case 'CREATE_TAB':
                    case 'CREATE_TAB_FROM_URL':
                    case 'RENAME_WINDOW':
                    case 'CLOSE_WINDOW':
                    case 'RESTORE_WINDOW':
                    case 'DELETE_WINDOW_STATE':
                    case 'FLATTEN_IMMEDIATE':
                    case 'FLATTEN_TREE':
                    case 'CREATE_GROUP':
                    case 'RENAME_NODE':
                    case 'FOCUS_TAB':
                        this._broadcast({ type: 'RENDER_ALL', payload: {} });
                        break;

                    default:
                        throw utils.exhausted(message);
                }
                break;
            default:
                throw utils.exhausted(event);
        }
    }

    async _process_event(event: StateManagerEvent) {
        if (event.type == "portMessage") {
            console.log(Date.now(), event.type, event.payload.message.type, event.payload.message.payload);
        } else {
            console.log(Date.now(), event.type, event.payload);
        }

        switch (event.type) {
            case 'tabCreated': {
                let t = event.payload;
                let tbid = this.get_tab_id(t.id);
                let wbid = this.get_window_id(t.windowId);
                if (!tbid || !wbid) return;
                let wid = t.windowId!;

                const nw = await browser.windows.get(wid, { populate: true });
                this.windows.set(wid, {
                    id: wbid,
                    wid: wid,
                    ctime: Date.now(),
                    tabs: nw.tabs ?? [],
                });

                this._set_tab(tbid, t, "opener");
            } break;
            case 'tabRemoved': {
                let e = event.payload;
                const bruhId = this.tab_id_map.get(e.tabId);
                if (bruhId) this.tree.delete(bruhId);
                this.tab_id_map.delete(e.tabId);

                if (!e.removeInfo.isWindowClosing) {
                    const w = this.windows.get(e.removeInfo.windowId);
                    if (w) {
                        try {
                            const nw = await browser.windows.get(e.removeInfo.windowId, { populate: true });
                            w.tabs = nw.tabs!;
                        } catch (err) {
                            // Window might already be closed
                        }
                    }
                }
            } break;
            case 'tabUpdated': {
                let e = event.payload;
                let t = e.tab;
                let tbid = this.get_tab_id(e.tabId);
                let wbid = this.get_window_id(t.windowId);
                if (!wbid) return;
                let wid = t.windowId!;

                this._set_tab(tbid, t, "old");

                const nw = await browser.windows.get(wid, { populate: true });
                this.windows.set(wid, {
                    id: wbid,
                    wid: wid,
                    ctime: Date.now(),
                    tabs: nw.tabs ?? [],
                });
            } break;
            case 'tabMoved': {
                let e = event.payload;
                let wid = e.moveInfo.windowId;
                let wbid = this.get_window_id(wid);
                const nw = await browser.windows.get(wid, { populate: true });
                this.windows.set(wid, {
                    id: wbid,
                    wid: wid,
                    ctime: Date.now(),
                    tabs: nw.tabs ?? [],
                });
            } break;
            case 'tabAttached': {
                let e = event.payload;
                let wid = e.attachInfo.newWindowId;
                let wbid = this.get_window_id(wid);
                const nw = await browser.windows.get(wid, { populate: true });
                this.windows.set(wid, {
                    id: wbid,
                    wid: wid,
                    ctime: Date.now(),
                    tabs: nw.tabs ?? [],
                });
            } break;
            case 'tabDetached': {
                let e = event.payload;
                const w = this.windows.get(e.detachInfo.oldWindowId);
                if (w) {
                    try {
                        const nw = await browser.windows.get(e.detachInfo.oldWindowId, { populate: true });
                        w.tabs = nw.tabs ?? [];
                    } catch (e) {
                        console.warn(e);
                    }
                }
            } break;
            case 'tabActivated': {
                const e = event.payload;
                const w = this.windows.get(e.windowId);
                if (!w) return;
                const nw = await browser.windows.get(e.windowId, { populate: true });
                w.tabs = nw.tabs ?? [];
            } break;
            case 'windowCreated': {
                const e = event.payload;
                const wbid = this.get_window_id(e.id);
                if (!wbid) return;
                let wid = e.id!;

                // fetch again with .populate = true
                const nw = await browser.windows.get(wid, { populate: true });
                this.windows.set(wid, {
                    id: wbid,
                    wid: wid,
                    tabs: nw.tabs ?? [],
                    ctime: Date.now(),
                });
                this.tree.set(wbid, { type: 'window', id: wbid, wid: wid, title: `Window ${wid}` });
            } break;
            case 'windowRemoved': {
                const wid = event.payload;
                const win = Array.from(this.windows.values()).find(w => w.wid === wid);
                if (win) {
                    this.tree.delete(win.id);
                    this.windows.delete(wid);
                }
            } break;
            case 'portMessage': {
                let port = event.payload.port;
                let message = event.payload.message;
                switch (message.type) {
                    case 'GET_STATE_FOR_WINDOW': {
                        const state = this._buildUiStateForRender(message.payload.windowId);
                        if (state) this._post(port, { type: 'STATE_UPDATE', payload: { state } });
                    } break;
                    case 'GET_STATE_FOR_GROUP_VIEW': {
                        const rootNode = this.tree.get(message.payload.nodeId);
                        if (rootNode && (rootNode.type === 'tab' || rootNode.type === 'group')) {
                            const tab = Array.from(this.windows.values()).flatMap(w => w.tabs).find(t => t.id === rootNode.tid);
                            if (tab?.windowId) {
                                const state = this._buildUiStateForRender(tab.windowId, message.payload.nodeId);
                                if (state) this._post(port, { type: 'STATE_UPDATE', payload: { state } });
                            }
                        }
                    } break;
                    case 'GET_ALL_WINDOW_STATES': {
                        const states = Array.from(this.windows.keys()).map(wid => this._buildUiStateForRender(wid)).filter(s => s) as UiStateForRender[];
                        this._post(port, { type: 'ALL_STATES_UPDATE', payload: { states } });
                    } break;
                    case 'TOGGLE_COLLAPSE': {
                        const n = this.tree.get(message.payload.nodeId);
                        if (!n || n.type === "window") return;
                        n.collapsed = !n.collapsed;
                    } break;
                    case 'HANDLE_DROP': {
                        const { dragData, targetNodeId, action, targetWindowId } = message.payload;
                        const targetNode = this.tree.get(targetNodeId);
                        const targetWin = this.windows.get(targetWindowId);
                        if (!targetNode || !targetWin) return;

                        let newParentId: BruhId;
                        let index = -1;
                        const orderedTabs = this._getOrderedTabList(targetWindowId);

                        const lastDescendantIndex = orderedTabs.lastIndexOf(this._getSubtree(targetNodeId).pop()!);
                        const currentIndex = orderedTabs.indexOf(dragData.draggedNodeId);
                        const targetIndex = orderedTabs.indexOf(targetNodeId);
                        switch (action) {
                            case 'above':
                                newParentId = (targetNode as any).parentId;
                                index = currentIndex > targetIndex ? targetIndex : targetIndex - 1;
                                break;
                            case 'below':
                                newParentId = (targetNode as any).parentId;
                                index = currentIndex > lastDescendantIndex ? lastDescendantIndex + 1 : lastDescendantIndex;
                                break;
                            case 'root':
                                newParentId = targetWin.id;
                                index = targetWin.tabs.length;
                                break;
                            case 'inside':
                            default:
                                newParentId = targetNode.id;
                                index = currentIndex > lastDescendantIndex ? lastDescendantIndex + 1 : lastDescendantIndex;
                                break;
                        }

                        const tidsToMove: TabId[] = [];
                        const draggedNode = this.tree.get(dragData.draggedNodeId)!;
                        if (draggedNode.type == "window") {
                            const groupTab = await browser.tabs.create({ windowId: targetWindowId, index, url: browser.runtime.getURL(`overview.html?view=group`), active: false, openerTabId: newParentId });
                            await browser.tabs.update(groupTab.id!, { url: browser.runtime.getURL(`overview.html?view=group&id=${this.get_tab_id(groupTab.id!)}`) });
                            const newNodeId = this.get_tab_id(groupTab.id!);
                            this._set_tab(newNodeId, groupTab, "opener");

                            newParentId = newNodeId;
                            index += 1;
                        }

                        for (const nodeId of dragData.movedNodeIds) {
                            const node = this.tree.get(nodeId);
                            if (node && (node.type === 'tab' || node.type === 'group')) {
                                if (draggedNode.type == "window") {
                                    if (node.parentId == dragData.draggedNodeId) {
                                        node.parentId = newParentId;
                                    }
                                } else if (node.id === dragData.draggedNodeId) {
                                    node.parentId = newParentId;
                                }
                                tidsToMove.push(node.tid!);
                            }
                        }

                        await browser.tabs.move(tidsToMove, { windowId: targetWindowId, index });
                    } break;
                    case 'FOCUS_TAB': {
                        const node = this.tree.get(message.payload.nodeId);
                        if (node && (node.type === 'tab' || node.type === 'group') && node.tid) {
                            const tab = await browser.tabs.get(node.tid);
                            await browser.windows.update(tab.windowId!, { focused: true });
                            await browser.tabs.update(node.tid, { active: true });
                        }
                    } break;
                    case 'CLOSE_SUBTREE': {
                        const tids = this._getSubtree(message.payload.nodeId)
                            .map(id => (this.tree.get(id) as any)?.tid)
                            .filter(tid => tid);
                        await browser.tabs.remove(tids);
                    } break;
                    case 'CLOSE_SINGLE_TAB': {
                        const node = this.tree.get(message.payload.nodeId);
                        if (!node || (node.type !== 'tab' && node.type !== 'group')) return;
                        const children = this._getChildrenMap().get(node.id) || [];
                        for (const childId of children) {
                            const childNode = this.tree.get(childId);
                            if (childNode && (childNode.type === 'tab' || childNode.type === 'group')) {
                                childNode.parentId = node.parentId;
                            }
                        }
                        await browser.tabs.remove(node.tid!);
                    } break;
                    case 'DUPLICATE_TAB_SMART': {
                        const node = this.tree.get(message.payload.nodeId);
                        if (!node || (node.type !== 'tab' && node.type !== 'group')) return;
                        const win = Array.from(this.windows.values()).find(w => w.tabs.some(t => t.id === node.tid));
                        if (!win) return;
                        const parent = this.tree.get(node.parentId);
                        const opener = parent?.type == "tab" || parent?.type == "group" ? parent.tid : undefined;
                        let index = message.payload.tabIndex === undefined ? undefined : message.payload.tabIndex + 1;
                        const newTab = await browser.tabs.create({ windowId: win.wid, url: node.url, active: false, openerTabId: opener, index: index });
                        const newNodeId = this.get_tab_id(newTab.id!);
                        this._set_tab(newNodeId, newTab, "opener");
                    } break;
                    case 'UNLOAD_TAB': {
                        const node = this.tree.get(message.payload.nodeId);
                        if (node && (node.type === 'tab' || node.type === 'group')) await browser.tabs.discard(node.tid!);
                    } break;
                    case 'UNLOAD_TREE': {
                        const tids = this._getSubtree(message.payload.nodeId).map(id => (this.tree.get(id) as any)?.tid).filter(tid => tid);
                        await browser.tabs.discard(tids);
                    } break;
                    case 'LOAD_TREE': {
                        const tids = this._getSubtree(message.payload.nodeId).map(id => (this.tree.get(id) as any)?.tid).filter(tid => tid);
                        for (const tid of tids) await browser.tabs.reload(tid);
                    } break;
                    case 'MOVE_SUBTREE_TO_NEW_WINDOW': {
                        const tids = this._getSubtree(message.payload.rootNodeId).map(id => (this.tree.get(id) as any)?.tid).filter(tid => tid !== undefined);
                        const newWindow = await browser.windows.create({ tabId: tids.shift() });
                        if (tids.length > 0) await browser.tabs.move(tids, { windowId: newWindow.id!, index: 1 });

                        let wid = newWindow.id!;
                        let wbid = this.get_window_id(wid);
                        this.windows.set(wid, {
                            id: wbid,
                            wid: wid,
                            tabs: [],
                            ctime: Date.now(),
                        });
                        this.tree.set(wbid, { type: 'window', id: wbid, wid: wid, title: `Window ${wid}` });

                        const tbid = message.payload.rootNodeId;
                        const node = this.tree.get(tbid)!;
                        if (node.type === 'window') return;

                        if (node.type === "group") {
                            for (let id of tids) {
                                const child = this.tree.get(this.get_tab_id(id))!;
                                if (child.type == "window") continue;
                                if (child.parentId == tbid) {
                                    child.parentId = wbid;
                                }
                            }

                            await browser.tabs.remove(node.tid!);
                        } else {
                            node.parentId = wbid;
                        }
                    } break;
                    case 'CREATE_TAB': {
                        await browser.tabs.create({ windowId: message.payload.windowId });
                    } break;
                    case 'CREATE_TAB_FROM_URL': {
                        const { url, windowId, index, parentId } = message.payload;
                        const newTab = await browser.tabs.create({ url, windowId, index, active: false });
                        if (parentId) {
                            const newNodeId = this.get_tab_id(newTab.id!);
                            const newNode = this.tree.get(newNodeId)! as any;
                            newNode.parentId = parentId;
                        }
                    } break;
                    case 'RENAME_WINDOW': {
                        const { windowId, newName } = message.payload;
                        const winNodeId = this.get_window_id(windowId);
                        const winNode = this.tree.get(winNodeId);
                        if (winNode) winNode.title = newName;
                    } break;
                    case 'CLOSE_WINDOW': {
                        await browser.windows.remove(message.payload.windowId);
                    } break;
                    case 'RESTORE_WINDOW': {
                        // This needs a proper implementation for handling closed states, which are currently not stored.
                    } break;
                    case 'DELETE_WINDOW_STATE': {
                        await browser.windows.remove(message.payload.windowId);
                    } break;
                    case 'FLATTEN_IMMEDIATE': {
                        const node = this.tree.get(message.payload.nodeId);
                        if (!node || node.type === 'window') return;
                        const children = this._getChildrenMap().get(node.id) || [];
                        for (const childId of children) {
                            const childNode = this.tree.get(childId) as any;
                            if (childNode) childNode.parentId = node.parentId;
                        }
                    } break;
                    case 'FLATTEN_TREE': {
                        const node = this.tree.get(message.payload.nodeId);
                        if (!node || node.type === 'window') return;
                        const descendants = this._getSubtree(node.id).filter(id => id !== node.id);
                        for (const descId of descendants) {
                            const descNode = this.tree.get(descId) as any;
                            if (descNode) descNode.parentId = node.parentId;
                        }
                    } break;
                    case 'CREATE_GROUP': {
                        const { windowId, parentId, index } = message.payload;
                        const pnode = this.tree.get(parentId)!;
                        const groupTab = await browser.tabs.create({ windowId, index, url: browser.runtime.getURL(`overview.html?view=group`), active: false, openerTabId: pnode.type == "window" ? undefined : pnode.tid });
                        await browser.tabs.update(groupTab.id!, { url: browser.runtime.getURL(`overview.html?view=group&id=${this.get_tab_id(groupTab.id!)}`) });
                        const newNodeId = this.get_tab_id(groupTab.id!);
                        this._set_tab(newNodeId, groupTab, "opener");
                    } break;
                    case 'RENAME_NODE': {
                        const { nodeId, newName } = message.payload;
                        const node = this.tree.get(nodeId);
                        if (node) node.title = newName;
                    } break;
                    default:
                        throw utils.exhausted(message);
                }
            } break;
            default:
                throw utils.exhausted(event);
        }
    }

    async process_events() {
        while (true) {
            const event = await this.eventChannel.wait_recv();
            if (!event) break;

            try {
                await this._process_event(event);
                this._broadcastUpdates(event);
            } catch (e) {
                console.error(e);
            }
        }
    }
}

async function main() {
    console.log("tabruh loaded");

    let app = await App.init();
    await app.attach_listeners();
    let _ = app.process_events();

    browser.runtime.onInstalled.addListener(async () => {
        browser.menus.create({
            id: "open-overview",
            title: "Overview Page",
            contexts: ["browser_action"],
        });
    });
    browser.menus.onClicked.addListener(async (info, tab) => {
        switch (info.menuItemId) {
            case "open-overview": {
                await browser.tabs.create({
                    url: browser.runtime.getURL("overview.html"),
                });
            } break;
            default:
                console.error("unknown menu item id " + info.menuItemId);
        }
    });

    browser.browserAction.onClicked.addListener(async (tab, info) => {
        if (info?.button == 0) {
            await browser.sidebarAction.toggle();
        } else if (info?.button == 1) {
            await browser.tabs.create({
                url: browser.runtime.getURL("overview.html"),
            });
        }
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
