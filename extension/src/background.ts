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
        for (const node of this.tree.values()) {
            if (node.type === 'tab' || node.type === 'group') {
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

        const allNodesInWindow = Array.from(this.tree.values()).filter(n => {
            if (n.type === 'window') return false;
            const tab = win.tabs.find(t => t.id === (n as any).tid);
            return !!tab;
        });

        const childrenMap = this._getChildrenMap();
        const rootIds: BruhId[] = [];
        const uiTree: Map<BruhId, UiNode> = new Map();
        const tabsById = new Map(win.tabs.map(t => [t.id!, t]));

        const nodesToRender = rootNodeId ? this._getSubtree(rootNodeId) : allNodesInWindow.map(n => n.id);

        for (const nodeId of nodesToRender) {
            const node = this.tree.get(nodeId);
            if (!node || node.type === 'window') continue;

            const tab = tabsById.get(node.tid!);
            if (!tab) continue;

            uiTree.set(node.id, {
                id: node.id,
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

        const rootTabs = rootIds.map(id => ({ id, index: tabsById.get((this.tree.get(id) as any).tid)?.index ?? Infinity }));
        rootTabs.sort((a, b) => a.index - b.index);

        const rootNode = rootNodeId ? this.tree.get(rootNodeId) : this.tree.get(win.id);

        return {
            id: rootNodeId || win.id,
            windowId: win.wid,
            name: rootNode?.title || '',
            isClosed: false, // This model doesn't handle closed windows yet
            creationTimestamp: win.ctime,
            tree: uiTree,
            tabsById,
            rootIds: rootTabs.map(rt => rt.id),
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
                    case 'POP_OUT_GROUP':
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
                if (!this.get_window_id(t.windowId)) return;

                this._set_tab(tbid, t, "old");
            } break;
            case 'tabMoved': {
                let e = event.payload;
                const w = this.windows.get(e.moveInfo.windowId);
                if (!w) return;
                const nw = await browser.windows.get(e.moveInfo.windowId, { populate: true });
                w.tabs = nw.tabs ?? [];
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
                        console.log(JSON.parse(JSON.stringify(this.tree)));
                        const { dragData, targetNodeId, action, targetWindowId } = message.payload;
                        const targetNode = this.tree.get(targetNodeId);
                        const targetWin = this.windows.get(targetWindowId);
                        if (!targetNode || !targetWin) return;

                        let newParentId: BruhId;
                        let index = -1;
                        const orderedTabs = this._getOrderedTabList(targetWindowId);

                        if (action === 'above' || action === 'below') {
                            newParentId = (targetNode as any).parentId;
                            const targetIndex = orderedTabs.indexOf(targetNodeId);
                            index = (action === 'above') ? targetIndex : targetIndex + 1;
                        } else if (action === 'inside') {
                            newParentId = targetNodeId;
                            const lastDescendantIndex = orderedTabs.lastIndexOf(this._getSubtree(targetNodeId).pop()!);
                            index = lastDescendantIndex + 1;
                        } else { // root
                            newParentId = targetWin.id;
                            index = -1;
                        }

                        const tidsToMove: TabId[] = [];
                        for (const nodeId of dragData.movedNodeIds) {
                            const node = this.tree.get(nodeId);
                            if (node && (node.type === 'tab' || node.type === 'group')) {
                                if (node.id === dragData.draggedNodeId) {
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
                        const newTab = await browser.tabs.create({ windowId: win.wid, url: node.url, active: false });
                        const newNodeId = this.get_tab_id(newTab.id!);
                        const newNode = this.tree.get(newNodeId)! as any;
                        newNode.parentId = node.parentId;
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
                        const groupTab = await browser.tabs.create({ windowId, index, url: browser.runtime.getURL(`overview.html?view=group`), active: false });
                        await browser.tabs.update(groupTab.id!, { url: browser.runtime.getURL(`overview.html?view=group&id=${this.get_tab_id(groupTab.id!)}`) });
                        const newNodeId = this.get_tab_id(groupTab.id!);
                        const newNode = this.tree.get(newNodeId)! as any;
                        if (parentId) newNode.parentId = parentId;
                    } break;
                    case 'RENAME_NODE': {
                        const { nodeId, newName } = message.payload;
                        const node = this.tree.get(nodeId);
                        if (node) node.title = newName;
                    } break;
                    case 'POP_OUT_GROUP': {
                        // TODO: might need some fix
                        const node = this.tree.get(message.payload.nodeId);
                        if (!node || node.type !== 'group' || !node.tid) return;
                        const children = this._getChildrenMap().get(node.id) || [];
                        const childrenTids = children.map(id => (this.tree.get(id) as any)?.tid).filter(tid => tid);
                        const newWindow = await browser.windows.create({ tabId: node.tid });
                        if (childrenTids.length > 0) await browser.tabs.move(childrenTids, { windowId: newWindow.id!, index: -1 });
                        const newWinNodeId = this.get_window_id(newWindow.id!)!;
                        for (const childId of children) {
                            const childNode = this.tree.get(childId) as any;
                            if (childNode) childNode.parentId = newWinNodeId;
                        }
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

/*
class StateManager {
    private id: number = 1;
    private ports: Set<browser.Runtime.Port> = new Set();
    private eventChannel: utils.Channel<StateManagerEvent> = new utils.Channel();
    private tree: TabTree = new Map();

    private windowStates: Map<number, WindowState> = new Map();
    private windowIdToStateId: Map<number, number> = new Map();
    private restoringStateId: number | null = null;
    private nodeToCustomTitle: Map<number, string> = new Map();

    private async processEvents() {
        while (true) {
            const event = await this.eventChannel.wait_recv();
            if (!event) break;

            switch (event.type) {
                case 'portMessage': {
                    const { message, port } = event.payload;
                    await this.handleMessage(message, port);
                    break;
                }
                case 'tabCreated': {
                    const tab = event.payload;
                    if (tab.windowId && tab.id) {
                        const stateId = this.windowIdToStateId.get(tab.windowId);
                        if (stateId) {
                            const windowState = this.windowStates.get(stateId);
                            const tabsInWindow = await browser.tabs.query({ windowId: tab.windowId });
                            const openerExists = tab.openerTabId && tabsInWindow.some(t => t.id === tab.openerTabId);

                            if (windowState && tab.openerTabId && openerExists) {
                                if (!windowState.parentMap.has(tab.id)) {
                                    windowState.parentMap.set(tab.id, tab.openerTabId);
                                }
                            }
                        }
                        await this.updateAndBroadcast(tab.windowId);
                    }
                    break;
                }
                case 'tabRemoved': {
                    const { tabId, removeInfo } = event.payload;
                    this.nodeToCustomTitle.delete(tabId);
                    if (!removeInfo.isWindowClosing && removeInfo.windowId) {
                        await this.updateAndBroadcast(removeInfo.windowId);
                        const stateId = this.windowIdToStateId.get(removeInfo.windowId);
                        if (stateId) {
                            await this.checkAndCleanupWindowState(stateId);
                        }
                    }
                    break;
                }
                case 'tabUpdated': {
                    const { tab } = event.payload;
                    if (tab.windowId) await this.updateAndBroadcast(tab.windowId);
                    break;
                }
                case 'tabMoved': {
                    const { moveInfo } = event.payload;
                    await this.updateAndBroadcast(moveInfo.windowId);
                    break;
                }
                case 'tabAttached': {
                    const { attachInfo } = event.payload;
                    await this.updateAndBroadcast(attachInfo.newWindowId);
                    break;
                }
                case 'tabDetached': {
                    const { detachInfo } = event.payload;
                    await this.updateAndBroadcast(detachInfo.oldWindowId);
                    const stateId = this.windowIdToStateId.get(detachInfo.oldWindowId);
                    if (stateId) {
                        await this.checkAndCleanupWindowState(stateId);
                    }
                    break;
                }
                case 'tabActivated': {
                    const activeInfo = event.payload;
                    const stateId = this.windowIdToStateId.get(activeInfo.windowId);
                    if (stateId) {
                        const state = this.windowStates.get(stateId);
                        if (state) state.lastActiveTabId = activeInfo.tabId;
                    }
                    await this.updateAndBroadcast(activeInfo.windowId);
                    break;
                }
                case 'windowCreated': {
                    const win = event.payload;
                    if (win.id && win.type === 'normal') {
                        const stateIdForRestoration = this.restoringStateId;
                        if (stateIdForRestoration) {
                            this.windowIdToStateId.set(win.id, stateIdForRestoration);
                        } else {
                            const stateId = this.id++;
                            const newState: WindowState = {
                                bid: stateId,
                                name: `Window ${win.id}`,
                                windowId: win.id,
                                isClosed: false,
                                creationTimestamp: Date.now(),
                                parentMap: new Map(),
                                collapsedNodes: new Set(),
                                tabs: [],
                                tree: new Map(),
                                tabsById: new Map(),
                                rootIds: [],
                            };
                            this.windowStates.set(stateId, newState);
                            this.windowIdToStateId.set(win.id, stateId);
                            await this.updateWindowStateByWindowId(win.id);
                            this.broadcastRenderAll();
                        }
                    }
                    break;
                }
                case 'windowRemoved': {
                    const windowId = event.payload;
                    const stateId = this.windowIdToStateId.get(windowId);
                    if (stateId && this.windowStates.has(stateId)) {
                        const state = this.windowStates.get(stateId)!;
                        state.isClosed = true;
                        state.closedTimestamp = Date.now();
                        delete state.windowId;
                        this.windowIdToStateId.delete(windowId);
                        this.broadcastRenderAll();
                    }
                    break;
                }
            }
        }
    }

    private isGroupTab(tab: browser.Tabs.Tab): boolean {
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

    private handleNewConnection(port: browser.Runtime.Port) {
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
    }

    private async handleMessage(message: BackgroundRequest, port: browser.Runtime.Port) {
        switch (message.type) {
            case 'GET_STATE_FOR_WINDOW':
                this.sendStateUpdateForWindow(message.payload.windowId, port);
                break;
            case 'GET_STATE_FOR_GROUP_VIEW':
                this.sendStateForGroupView(message.payload.nodeId, port);
                break;
            case 'GET_ALL_WINDOW_STATES':
                this.sendAllStatesUpdate(port);
                break;
            case 'TOGGLE_COLLAPSE':
                this.toggleCollapse(message.payload.stateId, message.payload.nodeId);
                this.broadcastRenderAll();
                break;
            case 'HANDLE_DROP':
                await this.handleDrop(message.payload.dragData, message.payload.targetTabId, message.payload.action, message.payload.targetStateId);
                break;
            case 'FOCUS_TAB': await this.focusTab(message.payload.tabId); break;
            case 'CLOSE_SUBTREE': await this.closeSubtree(message.payload.tabId); break;
            case 'CLOSE_SINGLE_TAB': await this.closeSingleTab(message.payload.tabId); break;
            case 'DUPLICATE_TAB_SMART': await this.duplicateTabSmart(message.payload.tabId); break;
            case 'UNLOAD_TAB': await browser.tabs.discard(message.payload.tabId); break;
            case 'UNLOAD_TREE': await this.unloadTree(message.payload.tabId); break;
            case 'LOAD_TREE': await this.loadTree(message.payload.tabId); break;
            case 'MOVE_SUBTREE_TO_NEW_WINDOW': await this.moveSubtreeToNewWindow(message.payload.rootTabId); break;
            case 'CREATE_TAB': await browser.tabs.create({ windowId: message.payload.windowId }); break;
            case 'CREATE_TAB_FROM_URL': await this.createTabFromUrl(message.payload); break;
            case 'APPLY_PENDING_DATA': this.applyPendingData(message.payload.dragData, message.payload.targetStateId); break;
            case 'RENAME_WINDOW': this.renameWindow(message.payload.stateId, message.payload.newName); break;
            case 'CLOSE_WINDOW': await this.closeWindow(message.payload.stateId); break;
            case 'RESTORE_WINDOW': await this.restoreWindow(message.payload.stateId); break;
            case 'DELETE_WINDOW_STATE': await this.deleteWindowState(message.payload.stateId); break;
            case 'FLATTEN_IMMEDIATE': await this.flattenImmediate(message.payload.tabId); break;
            case 'FLATTEN_TREE': await this.flattenTree(message.payload.tabId); break;
            case 'CREATE_GROUP': await this.createGroup(message.payload); break;
            case 'RENAME_NODE': this.renameNode(message.payload.nodeId, message.payload.newName); break;
            case 'POP_OUT_GROUP': await this.popOutGroup(message.payload.tabId); break;
        }
    }

    private getParent(tab: browser.Tabs.Tab, windowState: WindowState): number | undefined {
        if (tab.id === undefined) return undefined;
        const parentId = windowState.parentMap.get(tab.id);
        return parentId === -1 ? undefined : parentId;
    }

    private buildTabTreeForWindowState(stateId: number) {
        const windowState = this.windowStates.get(stateId);
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
            const node: TabNode = {
                bid: tab.id,
                title: tab.title ?? 'Untitled',
                url: tab.url ?? '',
                favIconUrl: tab.favIconUrl,
                parentId: this.getParent(tab, windowState),
                children: [],
            };
            if (this.isGroupTab(tab)) {
                node.isGroup = true;
            }
            if (this.nodeToCustomTitle.has(tab.id)) {
                node.customTitle = this.nodeToCustomTitle.get(tab.id);
            }
            nodes.set(tab.id, node);
        }

        for (const node of nodes.values()) {
            const parentId = node.parentId;
            if (parentId !== undefined && nodes.has(parentId)) {
                nodes.get(parentId)!.children.push(node.bid);
            } else {
                rootIds.push(node.bid);
            }
        }

        windowState.tree = nodes;
        windowState.tabsById = tabsById;
        windowState.rootIds = rootIds;
    }

    private async updateWindowStateByWindowId(windowId: number) {
        const stateId = this.windowIdToStateId.get(windowId);
        if (!stateId) return;
        const windowState = this.windowStates.get(stateId);
        if (!windowState) return;
        try {
            const tabs = await browser.tabs.query({ windowId });
            windowState.tabs = tabs;
            this.buildTabTreeForWindowState(stateId);
        } catch (e) {
            console.error(`Could not update state for window ${windowId}:`, e);
            this.windowStates.delete(stateId);
            this.windowIdToStateId.delete(windowId);
        }
    }

    private async updateAndBroadcast(windowId: number) {
        await this.updateWindowStateByWindowId(windowId);
        this.broadcastRenderAll();
    }

    private async checkAndCleanupWindowState(stateId: number) {
        const state = this.windowStates.get(stateId);
        if (!state) return;

        const isUnnamed = /^Window \d+$/.test(state.name);
        if (state.tabs.length === 0 && isUnnamed) {
            await this.deleteWindowState(stateId);
        }
    }

    private broadcastRenderAll() {
        for (const port of this.ports) {
            try {
                port.postMessage({ type: 'RENDER_ALL', payload: {} });
            } catch (e) {
                console.warn("Could not post message to a port, it might be closed.", e);
                this.ports.delete(port);
            }
        }
    }

    private getStateForUi(windowState: WindowState) {
        return {
            id: windowState.bid,
            name: windowState.name,
            isClosed: windowState.isClosed,
            windowId: windowState.windowId,
            creationTimestamp: windowState.creationTimestamp,
            tree: windowState.tree,
            tabsById: windowState.tabsById,
            rootIds: windowState.rootIds,
            collapsedNodes: windowState.collapsedNodes,
        };
    }

    private sendStateUpdateForWindow(windowId: number, port: browser.Runtime.Port) {
        const stateId = this.windowIdToStateId.get(windowId);
        if (!stateId) return;
        const windowState = this.windowStates.get(stateId);
        if (!windowState) return;

        try {
            port.postMessage({
                type: 'STATE_UPDATE',
                payload: { state: this.getStateForUi(windowState) }
            });
        } catch (e) {
            console.error("Failed to send state update, port might be disconnected.", e);
            this.ports.delete(port);
        }
    }

    private sendStateForGroupView(nodeId: number, port: browser.Runtime.Port) {
        const state = this.findWindowStateByTabId(nodeId);
        const node = state?.tree.get(nodeId);
        if (!state || !node || !node.isGroup) return;

        const groupViewTree: TabTree = new Map();
        const tabsForView: Map<number, browser.Tabs.Tab> = new Map();
        const queue = [...node.children];

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const descendantNode = state.tree.get(currentId);
            const tab = state.tabsById.get(currentId);
            if (descendantNode && tab) {
                groupViewTree.set(currentId, { ...descendantNode });
                tabsForView.set(currentId, tab);
                queue.push(...descendantNode.children);
            }
        }
        // Add the direct children to the root of the new tree view
        for (const childId of node.children) {
            const childNode = groupViewTree.get(childId);
            if (childNode) {
                childNode.parentId = undefined;
            }
        }


        const groupStateForUi = {
            id: state.bid,
            name: node.customTitle || node.title,
            isClosed: state.isClosed,
            windowId: state.windowId,
            creationTimestamp: state.creationTimestamp,
            tree: groupViewTree,
            tabsById: tabsForView,
            rootIds: [...node.children],
            collapsedNodes: state.collapsedNodes,
        };

        try {
            port.postMessage({ type: 'STATE_UPDATE', payload: { state: groupStateForUi } });
        } catch (e) {
            console.error("Failed to send group view state update", e);
            this.ports.delete(port);
        }
    }

    private sendAllStatesUpdate(port: browser.Runtime.Port) {
        try {
            const allStates = Array.from(this.windowStates.values()).map(this.getStateForUi);
            port.postMessage({
                type: 'ALL_STATES_UPDATE',
                payload: { states: allStates }
            });
        } catch (e) {
            console.error("Failed to send all states update, port might be disconnected.", e);
            this.ports.delete(port);
        }
    }

    private findWindowStateByTabId(tabId: number): WindowState | undefined {
        for (const state of this.windowStates.values()) {
            if (state.tabsById.has(tabId)) {
                return state;
            }
        }
        return undefined;
    }

    private getTabSubtreeIds(rootId: number, windowState: WindowState): number[] {
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
            if (tab.windowId) {
                await browser.windows.update(tab.windowId, { focused: true });
            }
            await browser.tabs.update(tabId, { active: true });
        } catch (e) { console.error(`Could not focus tab ${tabId}:`, e); }
    }

    private async closeSubtree(tabId: number) {
        try {
            const windowState = this.findWindowStateByTabId(tabId);
            if (!windowState || windowState.isClosed) return;
            const idsToClose = this.getTabSubtreeIds(tabId, windowState);
            await browser.tabs.remove(idsToClose);
        } catch (e) { console.error(`Could not close tab subtree ${tabId}`, e); }
    }

    private async closeSingleTab(tabId: number) {
        try {
            const windowState = this.findWindowStateByTabId(tabId);
            if (!windowState || windowState.isClosed || !windowState.windowId) return;

            const tabToClose = windowState.tabsById.get(tabId);
            if (!tabToClose) return;

            const nodeToClose = windowState.tree.get(tabId);
            const childIds = nodeToClose?.children ?? [];
            const parentId = nodeToClose?.parentId;

            if (childIds.length > 0) {
                for (const childId of childIds) {
                    windowState.parentMap.set(childId, parentId ?? -1);
                }
                await browser.tabs.move(childIds, { index: tabToClose.index, windowId: windowState.windowId });
            }

            await browser.tabs.remove(tabId);
        } catch (e) {
            console.error(`Could not close single tab ${tabId}`, e);
        }
    }

    private toggleCollapse(stateId: number, nodeId: number) {
        const windowState = this.windowStates.get(stateId);
        if (!windowState) return;
        if (windowState.collapsedNodes.has(nodeId)) {
            windowState.collapsedNodes.delete(nodeId);
        } else {
            windowState.collapsedNodes.add(nodeId);
        }
    }

    private async unloadTree(tabId: number) {
        try {
            const windowState = this.findWindowStateByTabId(tabId);
            if (!windowState || windowState.isClosed) return;
            const idsToDiscard = this.getTabSubtreeIds(tabId, windowState);
            await browser.tabs.discard(idsToDiscard);
        } catch (e) { console.error(`Could not unload tree for tab ${tabId}:`, e); }
    }

    private async loadTree(tabId: number) {
        try {
            const windowState = this.findWindowStateByTabId(tabId);
            if (!windowState || windowState.isClosed) return;
            const idsToLoad = this.getTabSubtreeIds(tabId, windowState);
            for (const id of idsToLoad) {
                await browser.tabs.reload(id);
            }
        } catch (e) { console.error(`Could not load tree for tab ${tabId}:`, e); }
    }

    private async duplicateTabSmart(tabId: number) {
        try {
            const windowState = this.findWindowStateByTabId(tabId);
            if (!windowState || windowState.isClosed || !windowState.windowId) return;

            const originalTab = windowState.tabsById.get(tabId);
            if (!originalTab) return;

            const parentId = windowState.parentMap.get(tabId);
            const lastDescendantIndex = this.findLastDescendantIndexInFlatList(tabId, windowState);

            const newTab = await browser.tabs.create({
                windowId: windowState.windowId,
                index: lastDescendantIndex + 1,
                url: originalTab.url,
                active: false,
            });

            if (newTab.id && parentId) {
                windowState.parentMap.set(newTab.id, parentId);
            } else if (newTab.id) {
                windowState.parentMap.set(newTab.id, -1);
            }
        } catch (e) {
            console.error(`Could not duplicate tab ${tabId}:`, e);
        }
    }

    private async createTabFromUrl(payload: { url: string; windowId: number; index?: number; parentId?: number; }) {
        try {
            const { url, windowId, index, parentId } = payload;
            const stateId = this.windowIdToStateId.get(windowId);
            const windowState = stateId ? this.windowStates.get(stateId) : undefined;
            if (!windowState) return;

            const newTab = await browser.tabs.create({
                url,
                windowId,
                index,
                active: false,
            });

            if (newTab.id && parentId) {
                windowState.parentMap.set(newTab.id, parentId);
            }
        } catch (e) {
            console.error('Failed to create tab from URL', e);
        }
    }

    private async moveSubtreeToNewWindow(rootTabId: number) {
        const sourceState = this.findWindowStateByTabId(rootTabId);
        if (!sourceState || sourceState.isClosed || !sourceState.windowId) return;

        const node = sourceState.tree.get(rootTabId);
        if (node?.isGroup) {
            await this.popOutGroup(rootTabId);
            return;
        }

        try {
            const sourceStateId = sourceState.bid;

            const movedTabIds = this.getTabSubtreeIds(rootTabId, sourceState);
            if (movedTabIds.length === 0) return;

            const newWindow = await browser.windows.create({ tabId: rootTabId });
            if (!newWindow.id) return;

            const otherTabIds = movedTabIds.filter(id => id !== rootTabId);
            if (otherTabIds.length > 0) {
                await browser.tabs.move(otherTabIds, { windowId: newWindow.id, index: -1 });
            }

            const newStateId = this.windowIdToStateId.get(newWindow.id);
            const newState = newStateId ? this.windowStates.get(newStateId) : undefined;
            if (!newState) return;

            for (const tabId of movedTabIds) {
                if (sourceState.parentMap.has(tabId)) {
                    newState.parentMap.set(tabId, sourceState.parentMap.get(tabId)!);
                    sourceState.parentMap.delete(tabId);
                }
                if (sourceState.collapsedNodes.has(tabId)) {
                    newState.collapsedNodes.add(tabId);
                    sourceState.collapsedNodes.delete(tabId);
                }
                if (this.nodeToCustomTitle.has(tabId)) {
                    this.nodeToCustomTitle.set(tabId, this.nodeToCustomTitle.get(tabId)!);
                }
            }
            newState.parentMap.set(rootTabId, -1);

            await this.updateWindowStateByWindowId(newWindow.id);
            if (sourceState.windowId) {
                await this.updateWindowStateByWindowId(sourceState.windowId);
            }
            this.broadcastRenderAll();
            await this.checkAndCleanupWindowState(sourceStateId);
        } catch (e) {
            console.error('Failed to move subtree to new window:', e);
        }
    }

    private applyPendingData(dragData: DragData, targetStateId: number) {
        const targetState = this.windowStates.get(targetStateId);
        const sourceState = this.windowStates.get(dragData.sourceStateId);
        if (!targetState || !sourceState) return;

        for (const [childId, parentId] of Object.entries(dragData.parentMapSnapshot)) {
            if (parentId !== undefined && parentId !== null) {
                targetState.parentMap.set(Number(childId), parentId);
            }
        }
        for (const id of dragData.collapsed) {
            targetState.collapsedNodes.add(id);
        }
        for (const id of dragData.movedTabIds) {
            sourceState.collapsedNodes.delete(id);
        }
    }

    private findLastDescendantIndexInFlatList(startNodeId: number, windowState: WindowState): number {
        const startTab = windowState.tabsById.get(startNodeId);
        if (!startTab) throw new Error(`Tab ${startNodeId} not found.`);

        let maxIndex = startTab.index;
        const subtreeIds = this.getTabSubtreeIds(startNodeId, windowState);
        for (const id of subtreeIds) {
            const tab = windowState.tabsById.get(id);
            if (tab && tab.index > maxIndex) maxIndex = tab.index;
        }
        return maxIndex;
    }

    private async handleDrop(dragData: DragData, targetTabId: number, action: string, targetStateId: number) {
        if (dragData.sourceStateId === targetStateId && dragData.type === 'window') return;

        if (dragData.type === 'window') {
            await this.handleWindowDrop(dragData, targetTabId, action, targetStateId);
        } else {
            await this.handleTabsDrop(dragData, targetTabId, action, targetStateId);
        }
    }

    private async handleWindowDrop(dragData: DragData, targetTabId: number, action: string, targetStateId: number) {
        const sourceState = this.windowStates.get(dragData.sourceStateId);
        const targetState = this.windowStates.get(targetStateId);
        if (!sourceState || !targetState || targetState.isClosed || !targetState.windowId) return;
        if (!sourceState.windowId) return;

        try {
            let index: number | undefined;
            let parentId: number | undefined;

            const targetTab = targetState.tabsById.get(targetTabId);

            switch (action) {
                case 'above':
                    index = targetTab?.index;
                    parentId = targetTab ? targetState.tree.get(targetTabId)?.parentId : -1;
                    break;
                case 'below':
                    index = targetTab ? this.findLastDescendantIndexInFlatList(targetTabId, targetState) + 1 : -1;
                    parentId = targetTab ? targetState.tree.get(targetTabId)?.parentId : -1;
                    break;
                case 'root':
                    index = targetState.tabs.length;
                    parentId = -1;
                    break;
                case 'inside':
                default:
                    index = targetTab ? this.findLastDescendantIndexInFlatList(targetTabId, targetState) + 1 : -1;
                    parentId = targetTab ? targetTabId : -1;
                    break;
            }

            const groupTab = await this.createGroup({ windowId: targetState.windowId, parentId, index }, false);
            if (!groupTab?.id) return;
            this.renameNode(groupTab.id, sourceState.name);

            await browser.tabs.move(dragData.movedTabIds, { windowId: targetState.windowId, index: groupTab.index + 1 });

            for (const [child, parent] of Object.entries(dragData.parentMapSnapshot)) {
                const childId = Number(child);
                if (parent === undefined || parent === null || parent === -1) {
                    targetState.parentMap.set(childId, groupTab.id);
                } else {
                    targetState.parentMap.set(childId, parent);
                }
            }

            for (const collapsed of dragData.collapsed) {
                targetState.collapsedNodes.add(collapsed);
            }

            await browser.windows.remove(sourceState.windowId);
            await this.updateAndBroadcast(targetState.windowId);

        } catch (e) {
            console.error('Failed to handle window drop:', e);
        }
    }


    private async handleTabsDrop(dragData: DragData, targetTabId: number, action: string, targetStateId: number) {
        const targetState = this.windowStates.get(targetStateId);
        const sourceState = this.windowStates.get(dragData.sourceStateId);
        if (!targetState || !sourceState || targetState.isClosed || !targetState.windowId) return;

        try {
            let index: number;
            let newParentId: number | undefined | null = null;

            const draggedTab = sourceState.tabsById.get(dragData.draggedTabId!);
            if (!draggedTab) return;
            const isMovingDown = dragData.sourceStateId === targetStateId && draggedTab.index < (targetState.tabsById.get(targetTabId)?.index ?? Infinity);

            switch (action) {
                case 'above': {
                    const targetTab = targetState.tabsById.get(targetTabId);
                    if (!targetTab) return;
                    index = targetTab.index;
                    newParentId = targetState.tree.get(targetTabId)?.parentId;
                    break;
                }
                case 'below': {
                    index = this.findLastDescendantIndexInFlatList(targetTabId, targetState) + 1;
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
                    index = this.findLastDescendantIndexInFlatList(targetTabId, targetState) + 1;
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
                targetState.parentMap.set(dragData.draggedTabId!, -1);
            } else {
                targetState.parentMap.set(dragData.draggedTabId!, newParentId);
            }

            await browser.tabs.move(dragData.movedTabIds, { index, windowId: targetState.windowId });

            await this.updateWindowStateByWindowId(targetState.windowId);
            if (sourceState.windowId && sourceState.windowId !== targetState.windowId) {
                await this.updateWindowStateByWindowId(sourceState.windowId);
            }
            this.broadcastRenderAll();
            await this.checkAndCleanupWindowState(dragData.sourceStateId);
        } catch (e) {
            console.error('Failed to handle drop:', e);
        }
    }

    private renameWindow(stateId: number, newName: string) {
        const state = this.windowStates.get(stateId);
        if (state) {
            state.name = newName;
            this.broadcastRenderAll();
        }
    }

    private async closeWindow(stateId: number) {
        const state = this.windowStates.get(stateId);
        if (state && state.windowId && !state.isClosed) {
            try {
                await browser.windows.remove(state.windowId);
            } catch (e) {
                console.error(`Failed to close window for state ${stateId}`, e);
            }
        }
    }

    private async deleteWindowState(stateId: number) {
        const state = this.windowStates.get(stateId);
        if (state) {
            const { windowId, isClosed } = state;

            this.windowStates.delete(stateId);
            if (windowId) {
                this.windowIdToStateId.delete(windowId);
            }

            for (const port of this.ports) {
                port.postMessage({ type: 'STATE_REMOVED', payload: { stateId } });
            }

            if (windowId && !isClosed) {
                try {
                    await browser.windows.remove(windowId);
                } catch (e) {
                    console.warn(`Could not remove window for state ${stateId}, it might have been closed already.`, e);
                }
            }
        }
    }

    private async restoreWindow(stateId: number) {
        const state = this.windowStates.get(stateId);
        if (!state || !state.isClosed) return;

        const tabsToCreate = [...state.tabsById.values()].sort((a, b) => a.index - b.index);
        if (tabsToCreate.length === 0) return;

        const activeTabInfo = state.tabsById.get(state.lastActiveTabId ?? -1) ?? tabsToCreate[0];
        if (!activeTabInfo) return;

        try {
            this.restoringStateId = stateId;

            const newWindow = await browser.windows.create({ url: activeTabInfo.url, state: 'maximized' });
            if (!newWindow.id || !newWindow.tabs || newWindow.tabs.length === 0) return;

            const newWindowId = newWindow.id;
            const firstNewTabId = newWindow.tabs[0]!.id!;

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
            for (const [oldChildId, oldParentId] of state.parentMap.entries()) {
                const newChildId = oldIdToNewIdMap.get(oldChildId);
                const newParentId = oldParentId === -1 ? -1 : oldIdToNewIdMap.get(oldParentId);
                if (newChildId !== undefined && newParentId !== undefined) {
                    newParentMap.set(newChildId, newParentId);
                }
            }

            state.isClosed = false;
            state.windowId = newWindowId;
            delete state.closedTimestamp;
            state.parentMap = newParentMap;

            await this.updateWindowStateByWindowId(newWindowId);
            state.lastActiveTabId = firstNewTabId;

            if (allNewTabIdsToDiscard.length > 0) {
                await browser.tabs.discard(allNewTabIdsToDiscard);
            }

            this.broadcastRenderAll();

        } catch (e) { console.error(`Failed to restore state ${stateId}:`, e) }
        finally {
            this.restoringStateId = null;
        }
    }

    private async flattenImmediate(tabId: number) {
        const windowState = this.findWindowStateByTabId(tabId);
        if (!windowState || !windowState.windowId) return;

        const nodeToFlatten = windowState.tree.get(tabId);
        if (!nodeToFlatten || nodeToFlatten.children.length === 0) return;

        const tabToFlatten = windowState.tabsById.get(tabId);
        if (!tabToFlatten) return;

        const newParentId = windowState.parentMap.get(tabId) ?? -1;
        const childrenToMove = [...nodeToFlatten.children];

        for (const childId of childrenToMove) {
            windowState.parentMap.set(childId, newParentId);
        }

        await browser.tabs.move(childrenToMove, { index: tabToFlatten.index + 1, windowId: windowState.windowId });
        await this.updateAndBroadcast(windowState.windowId);
    }

    private async flattenTree(tabId: number) {
        const windowState = this.findWindowStateByTabId(tabId);
        if (!windowState || !windowState.windowId) return;

        const nodeToFlatten = windowState.tree.get(tabId);
        if (!nodeToFlatten || nodeToFlatten.children.length === 0) return;

        const tabToFlatten = windowState.tabsById.get(tabId);
        if (!tabToFlatten) return;

        const newParentId = windowState.parentMap.get(tabId) ?? -1;
        const allDescendants = this.getTabSubtreeIds(tabId, windowState).filter(id => id !== tabId);

        if (allDescendants.length === 0) return;

        for (const descendantId of allDescendants) {
            windowState.parentMap.set(descendantId, newParentId);
        }

        await browser.tabs.move(allDescendants, { index: tabToFlatten.index + 1, windowId: windowState.windowId });
        await this.updateAndBroadcast(windowState.windowId);
    }

    private async createGroup(payload: { windowId: number, parentId?: number, index?: number }, broadcast: boolean = true): Promise<browser.Tabs.Tab | undefined> {
        const { windowId, parentId, index } = payload;
        const stateId = this.windowIdToStateId.get(windowId);
        const windowState = stateId ? this.windowStates.get(stateId) : undefined;
        if (!windowState) return;

        const groupTab = await browser.tabs.create({
            windowId,
            index,
            url: browser.runtime.getURL(`overview.html?view=group`),
            active: false,
        });

        if (!groupTab.id) return;

        const finalURL = browser.runtime.getURL(`overview.html?view=group&id=${groupTab.id}`);
        await browser.tabs.update(groupTab.id, { url: finalURL });

        this.nodeToCustomTitle.set(groupTab.id, "New Group");

        if (parentId) {
            windowState.parentMap.set(groupTab.id, parentId);
        }
        if (broadcast) {
            await this.updateAndBroadcast(windowId);
        }
        return groupTab;
    }

    private renameNode(nodeId: number, newName: string) {
        const windowState = this.findWindowStateByTabId(nodeId);
        if (!windowState) return;
        this.nodeToCustomTitle.set(nodeId, newName);
        if (windowState.windowId) {
            this.updateAndBroadcast(windowState.windowId);
        } else {
            this.broadcastRenderAll();
        }
    }

    private async popOutGroup(tabId: number) {
        const sourceState = this.findWindowStateByTabId(tabId);
        const groupNode = sourceState?.tree.get(tabId);
        if (!sourceState || !sourceState.windowId || !groupNode || !groupNode.isGroup) return;

        const childrenIds = this.getTabSubtreeIds(tabId, sourceState).filter(id => id !== tabId);

        const newWindow = await browser.windows.create({ tabId: tabId });
        if (!newWindow.id) return;

        await browser.tabs.move(childrenIds, { windowId: newWindow.id, index: 1 });

        const newStateId = this.windowIdToStateId.get(newWindow.id);
        const newState = newStateId ? this.windowStates.get(newStateId) : undefined;
        if (!newState) return;

        newState.name = groupNode.customTitle || `Window ${newState.windowId}`;

        for (const movedId of childrenIds) {
            if (sourceState.parentMap.has(movedId)) {
                newState.parentMap.set(movedId, sourceState.parentMap.get(movedId)!);
            }
        }

        newState.parentMap.set(tabId, -1);
        console.log(newState);
        await this.updateAndBroadcast(sourceState.windowId);
        await this.updateAndBroadcast(newWindow.id);
    }
}
*/

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
