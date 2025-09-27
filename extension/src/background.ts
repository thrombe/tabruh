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
    BruhTab,
    BruhWindow,
    WindowId,
    BruhId,
} from './types'; import * as utils from './utils';

type GroupAttrs = { name: string; generation: number; isCustomNamed: boolean; };

class App {
    ports: Set<browser.Runtime.Port> = new Set();
    eventChannel: utils.Channel<StateManagerEvent> = new utils.Channel();

    bruhid: BruhId = 1;
    tree: NodeTree = new Map();
    windows: Map<WindowId, BruhWindow> = new Map();
    tabs: Map<TabId, BruhTab> = new Map();
    groupAttrs: Map<BruhId, GroupAttrs> = new Map();
    closing_window_tabs: Map<WindowId, Set<TabId>> = new Map();

    private adjectives = ["Agile", "Azure", "Blue", "Bold", "Bright", "Calm", "Clever", "Cool", "Crimson", "Eager", "Emerald", "Golden", "Green", "Happy", "Jade", "Jolly", "Keen", "Light", "Lime", "Lucky", "Magic", "Mega", "Navy", "New", "Noble", "Olive", "Orange", "Ornate", "Proud", "Purple", "Quick", "Quiet", "Red", "Regal", "Rose", "Ruby", "Silver", "Sky", "Solar", "Teal", "Topaz", "Urban", "Vivid", "Warm", "White", "Wise", "Yellow", "Zen"];
    private nouns = ["Alpaca", "Ant", "Ape", "Bear", "Bee", "Bird", "Bison", "Cat", "Clam", "Cobra", "Crane", "Crow", "Deer", "Dog", "Dove", "Duck", "Eagle", "Elk", "Emu", "Finch", "Fish", "Fly", "Fox", "Frog", "Goat", "Goose", "Hawk", "Hen", "Heron", "Ibex", "Ibis", "Jay", "Kite", "Kiwi", "Lark", "Lion", "Llama", "Mole", "Moth", "Mouse", "Mule", "Newt", "Owl", "Panda", "Puma", "Quail", "Rabbit", "Ram", "Rat", "Raven", "Rhino", "Rook", "Seal", "Shark", "Skunk", "Sloth", "Snail", "Stork", "Swan", "Tiger", "Toad", "Tuna", "Viper", "Wasp", "Wolf", "Wren", "Yak", "Zebra"];

    static async init() {
        let self = new App();
        await self.init_tree();
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
        browser.windows.onFocusChanged.addListener(async (windowId) => {
            let _ = await this.eventChannel.send({ type: 'windowFocusChanged', payload: windowId });
        });
    }

    private generateUniqueGroupName(): string {
        let name: string;
        const existingNames = new Set(Array.from(this.groupAttrs.values()).map(attr => attr.name));

        do {
            const adj = this.adjectives[Math.floor(Math.random() * this.adjectives.length)];
            const noun = this.nouns[Math.floor(Math.random() * this.nouns.length)];
            name = `${adj} ${noun}`;
        } while (existingNames.has(name));

        return name;
    }

    private getOrGenerateGroupAttrs(id: BruhId, generation?: number, preferredName?: string): GroupAttrs {
        if (this.groupAttrs.has(id)) {
            return this.groupAttrs.get(id)!;
        }

        const newAttrs: GroupAttrs = {
            name: preferredName || this.generateUniqueGroupName(),
            generation: generation || id,
            isCustomNamed: !!preferredName,
        };
        this.groupAttrs.set(id, newAttrs);
        return newAttrs;
    }

    get_tab(tid: TabId): { tab: BruhTab, node: Node & { type: "tab" | "group" } } {
        const tab = this.tabs.get(tid);
        if (!tab) throw Error(`tab with tid ${tid} does not exist`);
        const node = this.tree.get(tab.id);
        if (!node) throw Error(`tab(${tid}) node with bid ${tab.id} does not exist`);
        // @ts-ignore
        return { tab, node: node };
    }

    get_window(wid: WindowId): { win: BruhWindow, node: Node & { type: "window" } } {
        const win = this.windows.get(wid);
        if (!win) throw Error(`window with wid: ${wid} does not exist`);
        const node = this.tree.get(win.id);
        if (!node) throw Error(`window(${wid}) node with bid ${win.id} does not exist`);
        // @ts-ignore
        return { win, node: this.tree.get(win.id) };
    }

    get_node(bid: BruhId): { node: Node & { type: "window" }, win: BruhWindow } | { node: Node & { type: "tab" | "group" }, tab: BruhTab } {
        const node = this.tree.get(bid);
        if (!node) throw Error(`node with bid ${bid} does not exist`);
        if (node.type == "window") {
            return this.get_window(node.wid);
        } else {
            return this.get_tab(node.tid);
        }
    }

    save_tab(tab: browser.Tabs.Tab, parent: "window" | "opener"): { tab: BruhTab, node: Node & { type: "tab" | "group" } } {
        if (tab.id === undefined || tab.windowId === undefined) throw Error(`tab does not have an id or windowId? ${tab.title}`);
        const old = this.tabs.get(tab.id);
        if (old) {
            old.wid = tab.windowId;
            return this.get_tab(old.tid);
        } else {
            const new_tab = {
                id: this.bruhid++,
                tid: tab.id,
                wid: tab.windowId,
                closed: false,
            };
            this.tabs.set(tab.id, new_tab);

            const isGroup = this._isGroupTab(tab);

            let title: string;
            if (isGroup) {
                title = this.getOrGenerateGroupAttrs(new_tab.id).name;
            } else {
                title = tab.title ?? "Untitled";
            }

            const w = this.windows.get(tab.windowId!)!;
            let pid: BruhId;
            if (parent === "opener" && tab.openerTabId !== undefined) {
                const openerTab = this.get_tab(tab.openerTabId);
                pid = openerTab.tab.id;
            } else {
                pid = w.id;
            }

            const node = {
                id: new_tab.id,
                title: title,
                favIconUrl: tab.favIconUrl,
                type: isGroup ? "group" : "tab",
                tid: tab.id,
                url: tab.url ?? "",
                parentId: pid,
                collapsed: false,
            } as Node;
            this.tree.set(new_tab.id, node);
            return {
                tab: new_tab,
                // @ts-ignore
                node: node,
            };
        }
    }

    save_window(win: browser.Windows.Window): { win: BruhWindow, node: Node & { type: "window" } } {
        if (win.id === undefined) throw Error(`window does not have id :/`);
        const old = this.windows.get(win.id);
        if (old) {
            old.tabs = win.tabs ?? [];
            return this.get_window(old.wid);
        } else {
            const new_window = {
                id: this.bruhid++,
                wid: win.id,
                tabs: win.tabs ?? [],
                closed: false,
            };
            this.windows.set(win.id, new_window);

            const new_node = {
                id: new_window.id,
                title: this.getOrGenerateGroupAttrs(new_window.id).name,
                type: "window",
                wid: win.id,
            } as Node;
            this.tree.set(new_window.id, new_node);
            return {
                win: new_window,
                // @ts-ignore
                node: new_node,
            };
        }
    }

    remove_tab(tid: TabId) {
        const tab = this.get_tab(tid);
        this.groupAttrs.delete(tab.tab.id);
        this.tree.delete(tab.tab.id);
        this.tabs.delete(tab.tab.tid);
    }

    remove_window(wid: WindowId) {
        const win = this.get_window(wid);
        this.groupAttrs.delete(win.win.id);
        this.tree.delete(win.win.id);
        this.windows.delete(win.win.wid);
    }

    async init_tree() {
        let windows = await browser.windows.getAll({ windowTypes: ["normal"], populate: true });
        for (let w of windows) {
            const _ = this.save_window(w);
        }

        for (const win of windows) {
            for (const t of win.tabs ?? []) {
                // opener might not be present yet. so parent is set to "window"
                let _ = this.save_tab(t, "window");
            }
        }

        for (const win of windows) {
            for (const t of win.tabs ?? []) {
                const tab = this.get_tab(t.id!);
                if (t.openerTabId !== undefined) {
                    const opener = this.get_tab(t.openerTabId);
                    tab.node.parentId = opener.node.id;
                }
            }
        }
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
        const stack: BruhId[] = [rootId];
        const visited = new Set<BruhId>();

        const childrenMap = this._getChildrenMap();

        while (stack.length > 0) {
            const currentId = stack.pop()!;
            if (visited.has(currentId)) {
                continue;
            }
            visited.add(currentId);
            subtree.push(currentId);

            const children = childrenMap.get(currentId) || [];
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]!);
            }
        }
        return subtree;
    }

    private _getChildrenMap(): Map<BruhId, BruhId[]> {
        const map = new Map<BruhId, BruhId[]>();
        for (const [_, w] of this.windows) {
            for (const t of w.tabs) {
                const node = this.get_tab(t.id!).node;

                if (!map.has(node.parentId)) {
                    map.set(node.parentId, []);
                }
                map.get(node.parentId)!.push(node.id);
            }
        }
        return map;
    }

    private _getOrderedTabList(windowId: WindowId): BruhId[] {
        return this.get_window(windowId).win.tabs.map(t => this.get_tab(t.id!).node.id);
    }


    private _buildUiStateForRender(windowId: WindowId, rootNodeId?: BruhId): UiStateForRender | null {
        const win = this.windows.get(windowId);
        if (!win) return null;

        const childrenMap = this._getChildrenMap();
        const rootIds: BruhId[] = [];
        const uiTree: Map<BruhId, UiNode> = new Map();
        const tabsById = new Map(win.tabs.map(t => [t.id!, t]));

        let nodeIdsToIterate: BruhId[];
        if (rootNodeId) {
            nodeIdsToIterate = this._getSubtree(rootNodeId);
        } else {
            nodeIdsToIterate = win.tabs.map(t => this.get_tab_id(t.id!));
        }

        for (const bruhId of nodeIdsToIterate) {
            if (rootNodeId && bruhId === rootNodeId) continue;

            const node = this.tree.get(bruhId);
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
        const rootId = rootNodeId || win.id;
        const attrs = this.groupAttrs.get(rootId);

        if (!rootNode || !attrs) return null;

        return {
            id: rootId,
            windowId: win.wid,
            name: attrs.name,
            isCustomNamed: attrs.isCustomNamed,
            isClosed: false,
            creationTimestamp: attrs.ctime,
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
                    tabs: nw.tabs ?? [],
                    closed: false,
                });

                this._set_tab(tbid, t, "old");
            } break;
            case 'tabRemoved': {
                let e = event.payload;

                if (e.removeInfo.isWindowClosing) {
                    if (!this.closing_window_tabs.has(e.removeInfo.windowId)) {
                        this.closing_window_tabs.set(e.removeInfo.windowId, new Set());
                    }
                    this.closing_window_tabs.get(e.removeInfo.windowId)!.add(e.tabId);
                } else {
                    const bruhId = this.tab_id_map.get(e.tabId);
                    if (bruhId) {
                        this.groupAttrs.delete(bruhId);
                        this.tree.delete(bruhId);
                    }
                    this.tab_id_map.delete(e.tabId);

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
                    tabs: nw.tabs ?? [],
                    closed: false,
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
                    tabs: nw.tabs ?? [],
                    closed: false,
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
                    tabs: nw.tabs ?? [],
                    closed: false,
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
                    closed: false,
                });
                const attrs = this.getOrGenerateGroupAttrs(wbid, Date.now());
                this.tree.set(wbid, { type: 'window', id: wbid, wid: wid, title: attrs.name });
            } break;
            case 'windowRemoved': {
                const wid = event.payload;
                const win = this.windows.get(wid)!;

                // when the only tab on a window closes, you can't tell the difference between window close vs tab close.
                //  so what we can do here is - treat single tab window closes as non restorable closes.
                //  just keep track of all closed tabs for that window with .isWindowClosing on tabRemoved
                //  and check how many items it has on windowRemoved
                if (this.closing_window_tabs.has(wid)) {
                    const tabs = this.closing_window_tabs.get(wid)!;
                    if (tabs.size <= 1) {
                        this.closing_window_tabs.delete(wid);
                        for (let tid of tabs) {
                            let tbid = this.tab_id_map.get(tid);
                            if (tbid) {
                                this.groupAttrs.delete(tbid);
                                this.tab_id_map.delete(tid);
                                this.tree.delete(tbid);
                            }
                        }
                    } else {
                        // mark deleted and done
                        win.closed = true;
                        return;
                    }
                }

                this.tree.delete(win.id);
                this.groupAttrs.delete(win.id);
                this.windows.delete(wid);
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
                        const rootNode = this.tree.get(message.payload.nodeId)!;
                        if (rootNode.type === 'tab' || rootNode.type === 'group') {
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
                        let currentIndex = orderedTabs.indexOf(dragData.draggedNodeId);
                        currentIndex = currentIndex >= 0 ? currentIndex : Infinity;
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
                                newParentId = targetNode.id;
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
                            const oldAttrs = this.groupAttrs.get(draggedNode.id)!;
                            const newNodeId = this.bruhid++;
                            this.groupAttrs.set(newNodeId, { ...oldAttrs });
                            const url = browser.runtime.getURL(`overview.html?view=group&id=${newNodeId}`);

                            const groupTab = await browser.tabs.create({
                                windowId: targetWindowId,
                                index,
                                url,
                                active: false,
                            });
                            const groupNode = this._set_tab(newNodeId, groupTab, "window");
                            groupNode.parentId = newParentId;

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
                        // spawn it above the duplicated
                        let index = message.payload.tabIndex === undefined ? undefined : message.payload.tabIndex;
                        const newTab = await browser.tabs.create({
                            windowId: win.wid,
                            url: node.url,
                            active: false,
                            index: index,
                        });
                        const newNodeId = this.get_tab_id(newTab.id!);
                        const newNode = this._set_tab(newNodeId, newTab, "window");
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
                        const node = this.tree.get(message.payload.rootNodeId)!;
                        const newWindow = await browser.windows.create({ tabId: tids.shift() });
                        if (tids.length > 0) await browser.tabs.move(tids, { windowId: newWindow.id!, index: 1 });

                        let wid = newWindow.id!;
                        let wbid = this.get_window_id(wid);

                        const oldAttrs = (node.type === 'group') ? this.groupAttrs.get(node.id) : undefined;
                        const newAttrs = oldAttrs ? oldAttrs : { name: this.generateUniqueGroupName(), ctime: Date.now(), isCustomNamed: false };

                        this.windows.set(wid, {
                            id: wbid,
                            wid: wid,
                            tabs: [],
                            closed: false,
                        });
                        this.groupAttrs.set(wbid, newAttrs);
                        this.tree.set(wbid, { type: 'window', id: wbid, wid: wid, title: newAttrs.name });

                        if (node.type === 'window') return;

                        if (node.type === "group") {
                            for (let id of tids) {
                                const child = this.tree.get(this.get_tab_id(id))!;
                                if (child.type == "window") continue;
                                if (child.parentId == node.id) {
                                    child.parentId = wbid;
                                }
                            }
                            await browser.tabs.remove(node.tid!);
                        } else {
                            const tabNode = this.tree.get(this.get_tab_id(node.tid!))!;
                            if (tabNode.type !== 'window') {
                                tabNode.parentId = wbid;
                            }
                        }
                    } break;
                    case 'CREATE_TAB': {
                        const { windowId, parentId } = message.payload;

                        const orderedTabs = this._getOrderedTabList(windowId);
                        const lastDescendantId = this._getSubtree(parentId).pop()!;
                        const lastDescendantIndex = orderedTabs.indexOf(lastDescendantId);
                        const index = lastDescendantIndex >= 0 ? lastDescendantIndex + 1 : undefined;
                        const newTab = await browser.tabs.create({ windowId, index, active: false });
                        const newNodeId = this.get_tab_id(newTab.id!);
                        const node = this._set_tab(newNodeId, newTab, "window");
                        node.parentId = parentId;
                    } break;
                    case 'CREATE_TAB_FROM_URL': {
                        const { url, windowId, parentId } = message.payload;

                        const orderedTabs = this._getOrderedTabList(windowId);
                        const lastDescendantId = this._getSubtree(parentId).pop()!;
                        const lastDescendantIndex = orderedTabs.indexOf(lastDescendantId);
                        const index = lastDescendantIndex >= 0 ? lastDescendantIndex + 1 : undefined;
                        const newTab = await browser.tabs.create({ windowId, index, active: false });
                        const newNodeId = this.get_tab_id(newTab.id!);
                        const node = this._set_tab(newNodeId, newTab, "window");
                        node.parentId = parentId;
                    } break;
                    case 'RENAME_WINDOW': {
                        const { windowId, newName } = message.payload;
                        const winNodeId = this.get_window_id(windowId);
                        const winNode = this.tree.get(winNodeId);
                        const attrs = this.groupAttrs.get(winNodeId);
                        if (winNode && attrs) {
                            winNode.title = newName;
                            attrs.name = newName;
                            attrs.isCustomNamed = true;
                        }
                    } break;
                    case 'CLOSE_WINDOW': {
                        await browser.windows.remove(message.payload.windowId);
                    } break;
                    case 'RESTORE_WINDOW': {
                        // This needs a proper implementation for handling closed states, which are currently not stored.
                    } break;
                    case 'DELETE_WINDOW_STATE': {
                        const wid = message.payload.windowId;
                        const win = this.windows.get(wid)!;
                        if (win.closed) {
                            this.windows.delete(win.wid);
                            this.tree.delete(win.id);
                            this.groupAttrs.delete(win.id);
                        } else {
                            await browser.windows.remove(message.payload.windowId);
                        }
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
                        const { windowId, parentId } = message.payload;

                        const newNodeId = this.bruhid++;
                        let _ = this.getOrGenerateGroupAttrs(newNodeId);
                        const url = browser.runtime.getURL(`overview.html?view=group&id=${newNodeId}`);

                        const orderedTabs = this._getOrderedTabList(windowId);
                        const lastDescendantId = this._getSubtree(parentId).pop()!;
                        const lastDescendantIndex = orderedTabs.indexOf(lastDescendantId);
                        const index = lastDescendantIndex >= 0 ? lastDescendantIndex + 1 : undefined;


                        const groupTab = await browser.tabs.create({
                            windowId,
                            index,
                            url,
                            active: false,
                        });
                        const newNode = this._set_tab(newNodeId, groupTab, "window");
                        newNode.parentId = parentId;
                    } break;
                    case 'RENAME_NODE': {
                        const { nodeId, newName } = message.payload;
                        const node = this.tree.get(nodeId)!;
                        const attrs = this.groupAttrs.get(nodeId)!;
                        node.title = newName;
                        attrs.name = newName;
                        attrs.isCustomNamed = true;
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
                console.error('Caught an error:', e);
                if (e instanceof Error) {
                    console.error(e.stack);
                }
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
}

main()
