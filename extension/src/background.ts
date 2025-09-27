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

    get_tab(tid: TabId): BruhTab & Extract<Node, { type: "tab" | "group" }> {
        const tab = this.tabs.get(tid);
        if (!tab) throw Error(`tab with tid ${tid} does not exist`);
        const node = this.tree.get(tab.id);
        if (!node) throw Error(`tab(${tid}) node with bid ${tab.id} does not exist`);
        // @ts-ignore
        return { ...node, ...tab };
    }

    get_window(wid: WindowId): BruhWindow & Extract<Node, { type: "window" }> {
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

    save_tab(tab: browser.Tabs.Tab, parent: "window" | "opener", id: BruhId | undefined = undefined): BruhTab & Extract<Node, { type: "tab" | "group" }> {
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
            node.favIconUrl = tab.favIconUrl;
            return this.get_tab(old.tid);
        } else {
            const new_tab = {
                id: id !== undefined ? id : this.bruhid++,
                tid: tab.id,
                wid: tab.windowId,
                index: tab.index,
                discarded: tab.discarded ?? false,
                active: tab.active,
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

            const w = this.get_window(tab.windowId!);
            let pid: BruhId;
            if (parent === "opener" && tab.openerTabId !== undefined) {
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
            let _ = this.save_window(w);
        }

        for (const win of windows) {
            for (const t of win.tabs ?? []) {
                // opener might not be set yet, so parent param is "window"
                let _ = this.save_tab(t, "window");
            }
        }

        for (const win of windows) {
            for (const t of win.tabs ?? []) {
                if (t.openerTabId !== undefined) {
                    const tab = this.get_tab(t.id!);
                    const opener = this.get_tab(t.openerTabId);
                    tab.parentId = opener.id;
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
                const node = this.get_tab(t.id!);

                if (!map.has(node.parentId)) {
                    map.set(node.parentId, []);
                }
                map.get(node.parentId)!.push(node.id);
            }
        }
        return map;
    }

    private _getOrderedTabList(windowId: WindowId): BruhId[] {
        return this.get_window(windowId).tabs.map(t => this.get_tab(t.id!).id);
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
                const win = await browser.windows.get(t.windowId!, { populate: true });
                this.save_window(win);
                this.save_tab(t, "opener");
            } break;
            case 'tabRemoved': {
                const e = event.payload;
                if (e.removeInfo.isWindowClosing) {
                    if (!this.closing_window_tabs.has(e.removeInfo.windowId)) {
                        this.closing_window_tabs.set(e.removeInfo.windowId, new Set());
                    }
                    this.closing_window_tabs.get(e.removeInfo.windowId)!.add(e.tabId);

                    const tab = this.tabs.get(e.tabId);
                    if (tab) tab.closed = true;
                } else {
                    this.remove_tab(e.tabId);
                    if (this.windows.has(e.removeInfo.windowId)) {
                        try {
                            const nw = await browser.windows.get(e.removeInfo.windowId, { populate: true });
                            this.save_window(nw);
                        } catch (err) { /* Window might already be closed */ }
                    }
                }
            } break;
            case 'tabUpdated': {
                const t = event.payload.tab;
                const win = await browser.windows.get(t.windowId!, { populate: true });
                this.save_window(win);
                this.save_tab(t, "opener");
            } break;
            case 'tabMoved': {
                const e = event.payload;
                const nw = await browser.windows.get(e.moveInfo.windowId, { populate: true });
                this.save_window(nw);
                const t = await browser.tabs.get(e.tabId);
                this.save_tab(t, "opener");
            } break;
            case 'tabAttached': {
                const e = event.payload;
                const tab = await browser.tabs.get(e.tabId);
                this.save_tab(tab, 'window');
                const newWin = await browser.windows.get(e.attachInfo.newWindowId, { populate: true });
                this.save_window(newWin);
            } break;
            case 'tabDetached': {
                const e = event.payload;
                try {
                    const oldWin = await browser.windows.get(e.detachInfo.oldWindowId, { populate: true });
                    this.save_window(oldWin);
                } catch (e) { console.warn(e); }
            } break;
            case 'tabActivated': {
                const e = event.payload;
                const win = await browser.windows.get(e.windowId, { populate: true });
                this.save_window(win);
                for (const t of win.tabs ?? []) {
                    this.get_tab(t.id!).active = t.active;
                }
            } break;
            case 'windowCreated': {
                const win = await browser.windows.get(event.payload.id!, { populate: true });
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
                        win.closed = true;
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
                        node.collapsed = !node.collapsed;
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
                                index = targetWin.tabs.length;
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
                            const groupTab = await browser.tabs.create({ windowId: targetWindowId, index, url, active: false });
                            const groupNode = this.save_tab(groupTab, "window", newNodeId);
                            groupNode.parentId = newParentId;
                            newParentId = groupNode.id;
                            index += 1;
                        }

                        const tidsToMove: TabId[] = [];
                        for (const nodeId of dragData.movedNodeIds) {
                            const node = this.get_node(nodeId);
                            if (node.type === 'tab' || node.type === 'group') {
                                if (draggedNode.type == "window") {
                                    if (node.parentId == draggedNode.id) node.parentId = newParentId;
                                } else if (node.id === draggedNode.id) {
                                    node.parentId = newParentId;
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
                            const childNode = this.get_node(childId);
                            if (childNode.type === "window") throw Error(`child bid: ${childId} of node bid: ${node.id} cannot be a window node`);
                            childNode.parentId = node.parentId;
                        }
                        await browser.tabs.remove(node.tid);
                    } break;
                    case 'DUPLICATE_TAB_SMART': {
                        const node = this.get_node(message.payload.nodeId);
                        if (node.type === 'window') return;
                        const newTab = await browser.tabs.create({
                            windowId: node.wid, url: node.url, active: false,
                            index: message.payload.tabIndex,
                        });
                        const newNode = this.save_tab(newTab, "window");
                        newNode.parentId = node.parentId;
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
                            win.title = oldAttrs.name;
                        }

                        if (node.type === "group") {
                            const subtree = this._getSubtree(rootNodeId);
                            for (let id of subtree) {
                                const child = this.get_node(id);
                                if (child.type === "window") throw Error(`child bid: ${child.id} of node bid: ${node.id} cannot be a window node`);
                                if (child.parentId === node.id) child.parentId = win.id;
                            }
                            await browser.tabs.remove(node.tid);
                        } else if (node.type === "tab") {
                            node.parentId = win.id;
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
                        node.parentId = parentId;
                    } break;
                    case 'CREATE_TAB_FROM_URL': {
                        const { url, windowId, parentId } = message.payload;
                        const orderedTabs = this._getOrderedTabList(windowId);
                        const lastDescendantId = this._getSubtree(parentId).pop()!;
                        const lastDescendantIndex = orderedTabs.indexOf(lastDescendantId);
                        const index = lastDescendantIndex >= 0 ? lastDescendantIndex + 1 : undefined;
                        const newTab = await browser.tabs.create({ windowId, url, index, active: false });
                        const node = this.save_tab(newTab, "window");
                        node.parentId = parentId;
                    } break;
                    case 'RENAME_WINDOW': {
                        const { windowId, newName } = message.payload;
                        const win = this.get_window(windowId);
                        const attrs = this.groupAttrs.get(win.id)!;
                        win.title = newName;
                        attrs.name = newName;
                        attrs.isCustomNamed = true;
                    } break;
                    case 'CLOSE_WINDOW': {
                        await browser.windows.remove(message.payload.windowId);
                    } break;
                    case 'RESTORE_WINDOW': {
                        // This needs a proper implementation for handling closed states, which are currently not stored.
                    } break;
                    case 'DELETE_WINDOW_STATE': {
                        const wid = message.payload.windowId;
                        const win = this.get_window(wid);
                        if (win.closed) {
                            for (let tab of win.tabs) {
                                this.remove_tab(tab.id!);
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
                            const childNode = this.get_node(childId);
                            if (childNode.type === "window") throw Error(`child bid: ${childNode.id} of node bid: ${node.id} cannot be a window node`);
                            childNode.parentId = node.parentId;
                        }
                    } break;
                    case 'FLATTEN_TREE': {
                        const node = this.get_node(message.payload.nodeId);
                        if (node.type === 'window') return;
                        const descendants = this._getSubtree(node.id).filter(id => id !== node.id);
                        for (const descId of descendants) {
                            const descNode = this.get_node(descId);
                            if (descNode.type === "window") throw Error(`descendent bid: ${descNode.id} of node bid: ${node.id} cannot be a window node`);
                            descNode.parentId = node.parentId;
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
                        const newNode = this.save_tab(groupTab, "window");
                        newNode.parentId = parentId;
                    } break;
                    case 'RENAME_NODE': {
                        const { nodeId, newName } = message.payload;
                        const node = this.get_node(nodeId);
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
