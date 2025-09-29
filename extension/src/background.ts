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
    restoring_tab_ids: Set<TabId> = new Set();
    restoring_window_ids: Set<WindowId> = new Set();

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

    get_tab(tid: TabId): Readonly<BruhTab & Extract<Node, { type: "tab" | "group" }>> {
        const tab = this.tabs.get(tid);
        if (!tab) throw Error(`tab with tid ${tid} does not exist`);
        const node = this.tree.get(tab.id);
        if (!node) throw Error(`tab(${tid}) node with bid ${tab.id} does not exist`);
        // @ts-ignore
        return { ...node, ...tab };
    }

    get_window(wid: WindowId): Readonly<BruhWindow & Extract<Node, { type: "window" }>> {
        const win = this.windows.get(wid);
        if (!win) throw Error(`window with wid: ${wid} does not exist`);
        const node = this.tree.get(win.id);
        if (!node) throw Error(`window(${wid}) node with bid ${win.id} does not exist`);
        // @ts-ignore
        return { ...node, ...win };
    }

    get_node(bid: BruhId) {
        const node = this.tree.get(bid);
        if (!node) throw Error(`node with bid ${bid} does not exist`);
        if (node.type == "window") {
            return this.get_window(node.wid);
        } else {
            return this.get_tab(node.tid);
        }
    }

    set_parent(bid: BruhId, parentId: BruhId) {
        const node = this.tree.get(bid);
        if (!node || node.type === 'window') throw Error(`Cannot set parent for node bid: ${bid}`);
        node.parentId = this.get_node(parentId).id;
    }

    set_collapsed(bid: BruhId, collapsed: boolean) {
        const node = this.tree.get(bid);
        if (!node || node.type === 'window') throw Error(`Cannot set collapsed for node bid: ${bid}`);
        node.collapsed = collapsed;
    }

    set_window_closed(wid: WindowId, closed: boolean) {
        const win = this.windows.get(wid);
        if (!win) throw Error(`Window with wid ${wid} not found`);
        win.closed = closed;
    }

    set_tab_closed(tid: TabId, closed: boolean) {
        const tab = this.tabs.get(tid);
        if (!tab) throw Error(`Tab with tid ${tid} not found`);
        tab.closed = closed;
    }

    set_title(bid: BruhId, title: string) {
        const node = this.tree.get(bid);
        if (!node) throw Error(`Node with bid ${bid} not found`);
        node.title = title;
    }

    save_tab(tab: browser.Tabs.Tab, parent: "window" | "opener", options: { id?: BruhId, forceIsGroup?: boolean } = {}): Readonly<BruhTab & Extract<Node, { type: "tab" | "group" }>> {
        if (tab.id === undefined || tab.windowId === undefined) throw Error(`tab does not have an id or windowId? ${tab.title}`);
        const old = this.tabs.get(tab.id);
        if (old) {
            old.wid = tab.windowId;
            old.index = tab.index;
            old.active = tab.active;
            old.discarded = tab.discarded ?? false;
            const node = this.tree.get(old.id) as Extract<Node, { type: "tab" | "group" }>;
            node.title = tab.title ?? node.title;
            node.url = tab.url ?? node.url;
            node.favIconUrl = tab.favIconUrl ?? node.favIconUrl;
            return this.get_tab(old.tid);
        } else {
            const new_tab = {
                id: options.id !== undefined ? options.id : this.bruhid++,
                tid: tab.id,
                wid: tab.windowId,
                index: tab.index,
                discarded: tab.discarded ?? false,
                active: tab.active,
                closed: false,
            };
            this.tabs.set(tab.id, new_tab);

            const isGroup = options.forceIsGroup || this._isGroupTab(tab);

            let title: string;
            if (isGroup) {
                title = this.getOrGenerateGroupAttrs(new_tab.id).name;
            } else {
                title = tab.title ?? "Untitled";
            }

            const w = this.get_window(tab.windowId!);
            let pid: BruhId;
            if (parent === "opener" && tab.openerTabId !== undefined && this.tabs.has(tab.openerTabId)) {
                const openerTab = this.get_tab(tab.openerTabId);
                pid = openerTab.id;
            } else {
                pid = w.id;
            }

            const node = {
                id: new_tab.id,
                title: title,
                type: isGroup ? "group" : "tab",
                tid: tab.id,
                url: tab.url ?? "",
                favIconUrl: tab.favIconUrl,
                parentId: pid,
                collapsed: false,
            } as Node;
            this.tree.set(new_tab.id, node);

            return this.get_tab(new_tab.tid);
        }
    }

    save_window(win: browser.Windows.Window) {
        if (win.id === undefined) throw Error(`window does not have id :/`);
        const old = this.windows.get(win.id);
        if (old) {
            return this.get_window(old.wid);
        } else {
            const new_window = {
                id: this.bruhid++,
                wid: win.id,
                tabIds: [],
                closed: false,
            };
            this.windows.set(win.id, new_window);
            const attrs = this.getOrGenerateGroupAttrs(new_window.id);

            const new_node = {
                id: new_window.id,
                title: attrs.name,
                type: "window",
                wid: win.id,
            } as Node;
            this.tree.set(new_window.id, new_node);

            return this.get_window(new_window.wid);
        }
    }

    remove_tab(tid: TabId) {
        const tab = this.tabs.get(tid);
        if (!tab) return;
        this.groupAttrs.delete(tab.id);
        this.tree.delete(tab.id);
        this.tabs.delete(tab.tid);
    }

    remove_window(wid: WindowId) {
        const win = this.windows.get(wid);
        if (!win) return;
        this.groupAttrs.delete(win.id);
        this.tree.delete(win.id);
        this.windows.delete(win.wid);
    }

    async init_tree() {
        let windows = await browser.windows.getAll({ windowTypes: ["normal"], populate: true });
        for (let w of windows) {
            this.save_window(w);
            const bruhWin = this.windows.get(w.id!)!;
            bruhWin.tabIds = w.tabs?.map(t => t.id!).filter(t => t !== undefined) as TabId[] ?? [];
        }

        for (const win of windows) {
            for (const t of win.tabs ?? []) {
                // opener might not be set yet, so parent param is "window"
                let _ = this.save_tab(t, "window");
            }
        }

        for (const win of windows) {
            for (const t of win.tabs ?? []) {
                if (t.openerTabId !== undefined && this.tabs.has(t.openerTabId)) {
                    const tab = this.get_tab(t.id!);
                    const opener = this.get_tab(t.openerTabId);
                    this.set_parent(tab.id, opener.id);
                }
            }
        }
    }

    private _isGroupTab(tab: browser.Tabs.Tab): boolean {
        if (!tab.url) return false;
        try {
            const url = new URL(tab.url);
            return url.protocol === 'moz-extension:' &&
                url.pathname.endsWith('/overview.html') &&
                url.searchParams.has('view') &&
                url.searchParams.get('view') === 'group';
        } catch (e) {
            // URL constructor failed, likely not a valid/standard URL (e.g., about:blank, internal UUIDs)
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
            for (const tid of w.tabIds) {
                const node = this.get_tab(tid);

                if (!map.has(node.parentId)) {
                    map.set(node.parentId, []);
                }
                map.get(node.parentId)!.push(node.id);
            }
        }
        return map;
    }

    private _getOrderedTabList(windowId: WindowId): BruhId[] {
        return this.get_window(windowId).tabIds.map(tid => this.get_tab(tid).id);
    }


    private _buildUiStateForRender(windowId: WindowId, rootNodeId?: BruhId): UiStateForRender {
        const win = this.get_window(windowId);

        const childrenMap = this._getChildrenMap();
        const rootIds: BruhId[] = [];
        const uiTree: Map<BruhId, UiNode> = new Map();

        const rootId = rootNodeId || win.id;
        let nodeIdsToIterate: BruhId[];
        if (rootNodeId) {
            nodeIdsToIterate = this._getSubtree(rootNodeId);
        } else {
            nodeIdsToIterate = this._getOrderedTabList(windowId);
        }

        for (const bruhId of nodeIdsToIterate) {
            if (rootNodeId && bruhId === rootNodeId) continue;

            const node = this.get_node(bruhId);
            if (node.type === 'window') continue;

            uiTree.set(node.id, {
                id: node.id,
                tid: node.tid,
                tab_index: node.index,
                title: node.title,
                url: node.url,
                favIconUrl: node.favIconUrl,
                isGroup: node.type === 'group',
                isDiscarded: node.discarded,
                isActive: node.active,
                isCollapsed: node.collapsed,
                children: childrenMap.get(node.id) || [],
            });

            if (node.parentId === rootId) {
                rootIds.push(node.id);
            }
        }

        const rootNode = this.get_node(rootId);
        const attrs = this.groupAttrs.get(rootNode.id)!;

        return {
            id: rootNode.id,
            windowId: win.wid,
            name: attrs.name,
            isCustomNamed: attrs.isCustomNamed,
            isClosed: win.closed,
            generation: attrs.generation,
            tree: uiTree,
            tabsById: new Map(this.tabs.entries()),
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

            case 'windowFocusChanged':
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
                const t = event.payload;
                if (this.restoring_tab_ids.has(t.id!)) {
                    this.restoring_tab_ids.delete(t.id!);
                    return;
                }
                this.save_tab(t, "opener");
                const win = this.windows.get(t.windowId!);
                if (win && t.id) {
                    win.tabIds.splice(t.index, 0, t.id);
                    for (let i = t.index + 1; i < win.tabIds.length; i++) {
                        const tabToUpdate = this.tabs.get(win.tabIds[i]!);
                        if (tabToUpdate) tabToUpdate.index = i;
                    }
                }
            } break;
            case 'tabRemoved': {
                const e = event.payload;
                const tabToRemove = this.tabs.get(e.tabId);

                if (e.removeInfo.isWindowClosing) {
                    if (!this.closing_window_tabs.has(e.removeInfo.windowId)) {
                        this.closing_window_tabs.set(e.removeInfo.windowId, new Set());
                    }
                    this.closing_window_tabs.get(e.removeInfo.windowId)!.add(e.tabId);
                    this.set_tab_closed(e.tabId, true);
                } else {
                    if (tabToRemove) {
                        const win = this.windows.get(tabToRemove.wid);
                        if (win) {
                            const oldIndex = win.tabIds.indexOf(e.tabId);
                            if (oldIndex > -1) {
                                win.tabIds.splice(oldIndex, 1);
                                for (let i = oldIndex; i < win.tabIds.length; i++) {
                                    const tabToUpdate = this.tabs.get(win.tabIds[i]!);
                                    if (tabToUpdate) tabToUpdate.index = i;
                                }
                            }
                        }
                    }
                    this.remove_tab(e.tabId);
                }
            } break;
            case 'tabUpdated': {
                const t = event.payload.tab;
                this.save_tab(t, "opener");
            } break;
            case 'tabMoved': {
                const { tabId, moveInfo } = event.payload;
                const win = this.windows.get(moveInfo.windowId);
                if (win) {
                    const [movedTabId] = win.tabIds.splice(moveInfo.fromIndex, 1);
                    win.tabIds.splice(moveInfo.toIndex, 0, movedTabId!);
                    for (let i = 0; i < win.tabIds.length; i++) {
                        const tabToUpdate = this.tabs.get(win.tabIds[i]!);
                        if (tabToUpdate) tabToUpdate.index = i;
                    }
                }
            } break;
            case 'tabAttached': {
                const { tabId, attachInfo } = event.payload;
                const tab = this.tabs.get(tabId);
                if (tab) {
                    const newWin = this.windows.get(attachInfo.newWindowId);
                    if (newWin) {
                        tab.wid = attachInfo.newWindowId;
                        newWin.tabIds.splice(attachInfo.newPosition, 0, tabId);
                        for (let i = 0; i < newWin.tabIds.length; i++) {
                            const tabToUpdate = this.tabs.get(newWin.tabIds[i]!);
                            if (tabToUpdate) tabToUpdate.index = i;
                        }
                    }
                }
            } break;
            case 'tabDetached': {
                const { tabId, detachInfo } = event.payload;
                const oldWin = this.windows.get(detachInfo.oldWindowId);
                if (oldWin) {
                    const oldIndex = oldWin.tabIds.indexOf(tabId);
                    if (oldIndex > -1) {
                        oldWin.tabIds.splice(oldIndex, 1);
                        for (let i = oldIndex; i < oldWin.tabIds.length; i++) {
                            const tabToUpdate = this.tabs.get(oldWin.tabIds[i]!);
                            if (tabToUpdate) tabToUpdate.index = i;
                        }
                    }
                }
            } break;
            case 'tabActivated': {
                const e = event.payload;
                const win = this.windows.get(e.windowId);
                if (win) {
                    for (const tid of win.tabIds) {
                        const tab = this.tabs.get(tid);
                        if (tab) tab.active = (tab.tid === e.tabId);
                    }
                }
            } break;
            case 'windowCreated': {
                const win = event.payload;
                if (this.restoring_window_ids.has(win.id!)) {
                    this.restoring_window_ids.delete(win.id!);
                    return;
                }
                this.save_window(win);
            } break;
            case 'windowRemoved': {
                const wid = event.payload;
                const win = this.get_window(wid);

                // when the only tab on a window closes, you can't tell the difference between window close vs tab close.
                //  so what we can do here is - treat single tab window closes as non restorable closes.
                //  just keep track of all closed tabs for that window with .isWindowClosing on tabRemoved
                //  and check how many items it has on windowRemoved
                if (this.closing_window_tabs.has(wid)) {
                    const closedTabs = this.closing_window_tabs.get(wid)!;
                    this.closing_window_tabs.delete(wid);
                    if (closedTabs.size > 1) {
                        this.set_window_closed(wid, true);
                        return; // Keep state as a closed window
                    } else {
                        // Single-tab window, treat as permanent removal
                        for (const tid of closedTabs) this.remove_tab(tid);
                    }
                }
                // If not from closing_window_tabs or single-tab close, remove permanently.
                this.remove_window(wid);
            } break;
            case 'windowFocusChanged': {
                // do nothing for now
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
                        const rootNode = this.get_node(message.payload.nodeId);
                        if (rootNode.type !== 'group') throw Error(`node bid: ${rootNode.id} is not a 'group'`);
                        this._post(port, { type: 'STATE_UPDATE', payload: { state: this._buildUiStateForRender(rootNode.wid, message.payload.nodeId) } });
                    } break;
                    case 'GET_ALL_WINDOW_STATES': {
                        const states = Array.from(this.windows.values())
                            .map(w => this._buildUiStateForRender(w.wid))
                            .filter(s => s) as UiStateForRender[];
                        this._post(port, { type: 'ALL_STATES_UPDATE', payload: { states } });
                    } break;
                    case 'TOGGLE_COLLAPSE': {
                        const node = this.get_node(message.payload.nodeId);
                        if (!(node.type === "tab" || node.type === "group")) throw Error(`node bid: ${node.id} cannot be collapsed`);
                        this.set_collapsed(node.id, !node.collapsed);
                    } break;
                    case 'HANDLE_DROP': {
                        const { dragData, targetNodeId, action, targetWindowId } = message.payload;
                        const targetNode = this.get_node(targetNodeId);
                        const targetWin = this.get_window(targetWindowId);

                        let newParentId: BruhId;
                        let index = -1;
                        const orderedTabs = this._getOrderedTabList(targetWindowId);

                        const lastDescendantId = this._getSubtree(targetNodeId).pop()!;
                        const lastDescendantIndex = orderedTabs.indexOf(lastDescendantId);
                        const draggedNode = this.get_node(dragData.draggedNodeId);
                        let currentIndex = (draggedNode.type !== 'window') ? orderedTabs.indexOf(draggedNode.id) : -1;
                        currentIndex = currentIndex >= 0 ? currentIndex : Infinity;
                        const targetIndex = orderedTabs.indexOf(targetNodeId);

                        switch (action) {
                            case 'above':
                                if (targetNode.type === "window") throw Error("'above' not supported for 'window' node");
                                newParentId = targetNode.parentId;
                                index = currentIndex > targetIndex ? targetIndex : targetIndex - 1;
                                break;
                            case 'below':
                                if (targetNode.type === "window") throw Error("'below' not supported for 'window' node");
                                newParentId = targetNode.parentId;
                                index = currentIndex > lastDescendantIndex ? lastDescendantIndex + 1 : lastDescendantIndex;
                                break;
                            case 'root':
                                newParentId = targetNode.id;
                                index = targetWin.tabIds.length;
                                break;
                            case 'inside':
                            default:
                                newParentId = targetNode.id;
                                index = currentIndex > lastDescendantIndex ? lastDescendantIndex + 1 : lastDescendantIndex;
                                break;
                        }

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
                                discarded: true,
                                title: oldAttrs.name,
                            });
                            const groupNode = this.save_tab(groupTab, "window", { id: newNodeId, forceIsGroup: true });
                            this.set_parent(groupNode.id, newParentId);
                            newParentId = groupNode.id;
                            index += 1;
                        }

                        const tidsToMove: TabId[] = [];
                        for (const nodeId of dragData.movedNodeIds) {
                            const node = this.get_node(nodeId);
                            if (node.type === 'tab' || node.type === 'group') {
                                if (draggedNode.type == "window") {
                                    if (node.parentId == draggedNode.id) this.set_parent(node.id, newParentId);
                                } else if (node.id === draggedNode.id) {
                                    this.set_parent(node.id, newParentId);
                                }
                                tidsToMove.push(node.tid);
                            }
                        }

                        await browser.tabs.move(tidsToMove, { windowId: targetWindowId, index });
                    } break;
                    case 'FOCUS_TAB': {
                        const node = this.get_node(message.payload.nodeId);
                        if (node.type === 'window') throw Error(`cannot focus 'window' node`);
                        await browser.tabs.update(node.tid, { active: true });
                    } break;
                    case 'CLOSE_SUBTREE': {
                        const tids = this._getSubtree(message.payload.nodeId)
                            .map(id => this.get_node(id))
                            .filter(n => n.type !== 'window')
                            .map(n => n.tid);
                        if (tids.length > 0) await browser.tabs.remove(tids);
                    } break;
                    case 'CLOSE_SINGLE_TAB': {
                        const node = this.get_node(message.payload.nodeId);
                        if (node.type === 'window') throw Error(`cannot close single 'window' node`);
                        const children = this._getChildrenMap().get(node.id) || [];
                        for (const childId of children) {
                            this.set_parent(childId, node.parentId);
                        }
                        await browser.tabs.remove(node.tid);
                    } break;
                    case 'DUPLICATE_TAB_SMART': {
                        const node = this.get_node(message.payload.nodeId);
                        if (node.type === 'window') return;
                        const isDuplicatingGroup = node.type === 'group';
                        const new_id = this.bruhid++;
                        const newTab = await browser.tabs.create({
                            windowId: node.wid,
                            url: isDuplicatingGroup ? browser.runtime.getURL(`overview.html?view=group&id=${new_id}`) : node.url,
                            active: false,
                            index: message.payload.tabIndex,
                        });
                        const newNode = this.save_tab(newTab, "window", { id: new_id, forceIsGroup: isDuplicatingGroup });
                        this.set_parent(newNode.id, node.parentId);
                    } break;
                    case 'UNLOAD_TAB': {
                        const node = this.get_node(message.payload.nodeId);
                        if (node.type === 'window') throw Error(`node bid: ${node.id} cannot be unloaded`);
                        await browser.tabs.discard(node.tid);
                    } break;
                    case 'UNLOAD_TREE': {
                        const tids = this._getSubtree(message.payload.nodeId).map(id => this.get_node(id)).filter(n => n.type !== 'window').map(n => n.tid);
                        if (tids.length > 0) await browser.tabs.discard(tids);
                    } break;
                    case 'LOAD_TREE': {
                        const tids = this._getSubtree(message.payload.nodeId).map(id => this.get_node(id)).filter(n => n.type !== 'window').map(n => n.tid);
                        for (const tid of tids) await browser.tabs.reload(tid);
                    } break;
                    case 'MOVE_SUBTREE_TO_NEW_WINDOW': {
                        const rootNodeId = message.payload.rootNodeId;
                        const tids = this._getSubtree(rootNodeId).map(id => this.get_node(id)).filter(n => n.type !== 'window').map(n => n.tid);
                        const node = this.get_node(rootNodeId);

                        const newWindow = await browser.windows.create({ tabId: tids.shift() });
                        if (tids.length > 0) await browser.tabs.move(tids, { windowId: newWindow.id!, index: 1 });
                        const fullNewWindow = await browser.windows.get(newWindow.id!, { populate: true });

                        const win = this.save_window(fullNewWindow);
                        const oldAttrs = this.groupAttrs.get(node.id);
                        if (oldAttrs) {
                            const newAttrs = this.groupAttrs.get(win.id)!;
                            newAttrs.name = oldAttrs.name;
                            newAttrs.isCustomNamed = oldAttrs.isCustomNamed;
                            newAttrs.generation = oldAttrs.generation;
                            this.set_title(win.id, oldAttrs.name);
                        }

                        if (node.type === "group") {
                            const subtree = this._getSubtree(rootNodeId);
                            for (let id of subtree) {
                                const child = this.get_node(id);
                                if (child.type === "window") throw Error(`child bid: ${child.id} of node bid: ${node.id} cannot be a window node`);
                                if (child.parentId === node.id) this.set_parent(child.id, win.id);
                            }
                            await browser.tabs.remove(node.tid);
                        } else if (node.type === "tab") {
                            this.set_parent(node.id, win.id);
                        }
                    } break;
                    case 'CREATE_TAB': {
                        const { windowId, parentId } = message.payload;
                        const orderedTabs = this._getOrderedTabList(windowId);
                        const lastDescendantId = this._getSubtree(parentId).pop()!;
                        const lastDescendantIndex = orderedTabs.indexOf(lastDescendantId);
                        const index = lastDescendantIndex >= 0 ? lastDescendantIndex + 1 : undefined;
                        const newTab = await browser.tabs.create({ windowId, index, active: false });
                        const node = this.save_tab(newTab, "window");
                        this.set_parent(node.id, parentId);
                    } break;
                    case 'CREATE_TAB_FROM_URL': {
                        const { url, windowId, parentId } = message.payload;
                        const orderedTabs = this._getOrderedTabList(windowId);
                        const lastDescendantId = this._getSubtree(parentId).pop()!;
                        const lastDescendantIndex = orderedTabs.indexOf(lastDescendantId);
                        const index = lastDescendantIndex >= 0 ? lastDescendantIndex + 1 : undefined;
                        const newTab = await browser.tabs.create({ windowId, url, index, active: false });
                        const node = this.save_tab(newTab, "window");
                        this.set_parent(node.id, parentId);
                    } break;
                    case 'RENAME_WINDOW': {
                        const { windowId, newName } = message.payload;
                        const win = this.get_window(windowId);
                        const attrs = this.groupAttrs.get(win.id)!;
                        this.set_title(win.id, newName);
                        attrs.name = newName;
                        attrs.isCustomNamed = true;
                    } break;
                    case 'CLOSE_WINDOW': {
                        await browser.windows.remove(message.payload.windowId);
                    } break;
                    case 'RESTORE_WINDOW': {
                        const wid = message.payload.windowId;

                        let old_to_new = new Map();
                        const win = this.get_window(wid);
                        const tabsToRestore = win.tabIds.map(tid => this.get_tab(tid));
                        const win_attrs = this.groupAttrs.get(win.id)!;

                        const new_bwin = await browser.windows.create({});
                        this.restoring_window_ids.add(new_bwin.id!);
                        const extra_tab = new_bwin.tabs![0]!;
                        this.save_window(new_bwin);
                        const new_win = this.windows.get(new_bwin.id!)!;

                        // Transfer attributes to the new window state
                        this.groupAttrs.set(new_win.id, { ...win_attrs });
                        old_to_new.set(win.id, new_win.id);
                        this.set_title(new_win.id, win_attrs.name);

                        // It is totally possible to have parent elements after children in tab.tabs
                        // so we pre-generate ids
                        for (const tab of tabsToRestore) {
                            const new_id = this.bruhid++;
                            old_to_new.set(tab.id, new_id);
                        }

                        for (const tab of tabsToRestore) {
                            const attrs = this.groupAttrs.get(tab.id);
                            const new_id = old_to_new.get(tab.id)!;

                            const new_btab = await browser.tabs.create({
                                windowId: new_win.wid,
                                url: tab.type == "group" ? browser.runtime.getURL(`overview.html?view=group&id=${new_id}`) : tab.url,
                                index: tab.index,
                                active: false,
                                discarded: true,
                                title: tab.title,
                            });

                            // Manually update our state, since tabCreated is guarded for restoring tabs.
                            if (attrs) {
                                this.groupAttrs.set(new_id, { ...attrs });
                            }
                            const new_tab = this.save_tab(new_btab, "window", { id: new_id, forceIsGroup: tab.type == "group" });
                            this.restoring_tab_ids.add(new_tab.tid);

                            // Manually add the new tab to our window state.
                            new_win.tabIds.splice(new_tab.index, 0, new_tab.tid);

                            this.set_collapsed(new_tab.id, tab.collapsed);
                            this.set_parent(new_tab.id, old_to_new.get(tab.parentId)!);
                            const new_tab_node = this.tree.get(new_tab.id)! as Node & { type: "tab" | "group" };
                            new_tab_node.favIconUrl = tab.favIconUrl;

                            if (tab.active) {
                                // await browser.tabs.update(new_tab.tid, { active: true });
                                await browser.tabs.remove(extra_tab.id!);
                            }
                        }

                        // Now that the new window is fully created, remove the old one from state.
                        for (const tab of tabsToRestore) {
                            this.remove_tab(tab.tid);
                        }
                        this.remove_window(wid);
                    } break;
                    case 'DELETE_WINDOW_STATE': {
                        const wid = message.payload.windowId;
                        const win = this.get_window(wid);
                        if (win.closed) {
                            for (let tid of win.tabIds) {
                                this.remove_tab(tid);
                            }
                            this.remove_window(wid);
                        } else {
                            await browser.windows.remove(wid);
                        }
                    } break;
                    case 'FLATTEN_IMMEDIATE': {
                        const node = this.get_node(message.payload.nodeId);
                        if (node.type === 'window') return;
                        const children = this._getChildrenMap().get(node.id) || [];
                        for (const childId of children) {
                            this.set_parent(childId, node.parentId);
                        }
                    } break;
                    case 'FLATTEN_TREE': {
                        const node = this.get_node(message.payload.nodeId);
                        if (node.type === 'window') return;
                        const descendants = this._getSubtree(node.id).filter(id => id !== node.id);
                        for (const descId of descendants) {
                            this.set_parent(descId, node.parentId);
                        }
                    } break;
                    case 'CREATE_GROUP': {
                        const { windowId, parentId } = message.payload;
                        const newNodeId = this.bruhid++;
                        this.getOrGenerateGroupAttrs(newNodeId);
                        const url = browser.runtime.getURL(`overview.html?view=group&id=${newNodeId}`);
                        const orderedTabs = this._getOrderedTabList(windowId);
                        const lastDescendantId = this._getSubtree(parentId).pop()!;
                        const lastDescendantIndex = orderedTabs.indexOf(lastDescendantId);
                        const index = lastDescendantIndex >= 0 ? lastDescendantIndex + 1 : undefined;
                        const groupTab = await browser.tabs.create({ windowId, index, url, active: false });
                        const newNode = this.save_tab(groupTab, "window", { id: newNodeId, forceIsGroup: true });
                        this.set_parent(newNode.id, parentId);
                    } break;
                    case 'RENAME_NODE': {
                        const { nodeId, newName } = message.payload;
                        const node = this.get_node(nodeId);
                        const attrs = this.groupAttrs.get(nodeId)!;
                        this.set_title(node.id, newName);
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
