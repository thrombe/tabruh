import browser from 'webextension-polyfill';
import type {
    BackgroundRequest,
    BackgroundResponse,
    DragData,
    Node,
    NodeTree,
    StateManagerEvent,
    TabId,
    HierarchyGenerationId,
    UiNode,
    UiStateForRender,
    BruhTab,
    BruhWindow,
    WindowId,
    BruhId,
    NodeStorageData,
    GroupAttrs,
} from './types';
import * as utils from './utils';
import manifest from './manifest.jsonc';

type StorageState = {
    bruhid: BruhId,
    hgid: HierarchyGenerationId,
    nodes: Record<string, NodeStorageData>,
    browserRestoreCache: Record<string, NodeStorageData>,
};

type Config = {
    dbg: {
        reset_state_on_load: boolean,
        log_events: boolean,
        log_sessions: boolean,
    },
    available_apis: {
        session_values: boolean,
    },
    features: {
        restore_strategy: "SessionsValues" | "SessionHistory",
    },
};
type UserConfig = {
    open_sidebar_on_new_windows: boolean,
};

type TabData = { node: Extract<Node, { type: "tab" | "group" }>, tab: BruhTab };
type WindowData = { node: Extract<Node, { type: "window" }>, win: BruhWindow };

class App {
    ports: Set<browser.Runtime.Port> = new Set();
    eventChannel: utils.Channel<StateManagerEvent> = new utils.Channel();

    config: Config;
    user_config: UserConfig;
    bruhid: BruhId = 1 as BruhId;
    hierarchy_generation_id: HierarchyGenerationId = 1 as HierarchyGenerationId;

    tree: NodeTree = new Map();
    windows: Map<WindowId, BruhWindow> = new Map();
    tabs: Map<TabId, BruhTab> = new Map();
    // TODO: maybe move this into bruhtab/bruhwindow?
    groupAttrs: Map<BruhId, GroupAttrs> = new Map();
    browserRestoreCache: Map<BruhId, NodeStorageData> = new Map();

    closing_window_tabs: Map<WindowId, Set<TabId>> = new Map();
    restoring_tab_ids: Set<TabId> = new Set();
    restoring_window_ids: Set<WindowId> = new Set();

    private session_pointer_key = "tabruh-bruh-id";
    private storage_key = "tabruh-app-state";

    private adjectives = ["Agile", "Azure", "Blue", "Bold", "Bright", "Calm", "Clever", "Cool", "Crimson", "Eager", "Emerald", "Golden", "Green", "Happy", "Jade", "Jolly", "Keen", "Light", "Lime", "Lucky", "Magic", "Mega", "Navy", "New", "Noble", "Olive", "Orange", "Ornate", "Proud", "Purple", "Quick", "Quiet", "Red", "Regal", "Rose", "Ruby", "Silver", "Sky", "Solar", "Teal", "Topaz", "Urban", "Vivid", "Warm", "White", "Wise", "Yellow", "Zen"];
    private nouns = ["Alpaca", "Ant", "Ape", "Bear", "Bee", "Bird", "Bison", "Cat", "Clam", "Cobra", "Crane", "Crow", "Deer", "Dog", "Dove", "Duck", "Eagle", "Elk", "Emu", "Finch", "Fish", "Fly", "Fox", "Frog", "Goat", "Goose", "Hawk", "Hen", "Heron", "Ibex", "Ibis", "Jay", "Kite", "Kiwi", "Lark", "Lion", "Llama", "Mole", "Moth", "Mouse", "Mule", "Newt", "Owl", "Panda", "Puma", "Quail", "Rabbit", "Ram", "Rat", "Raven", "Rhino", "Rook", "Seal", "Shark", "Skunk", "Sloth", "Snail", "Stork", "Swan", "Tiger", "Toad", "Tuna", "Viper", "Wasp", "Wolf", "Wren", "Yak", "Zebra"];

    constructor() {
        const session_values = browser.sessions.setWindowValue !== undefined;
        this.config = {
            dbg: {
                reset_state_on_load: true,
                log_events: true,
                log_sessions: false,
            },
            available_apis: {
                session_values: session_values,
            },
            features: {
                restore_strategy: session_values ? "SessionsValues" : "SessionHistory",
            },
        };

        this.user_config = {
            open_sidebar_on_new_windows: false,
        };

        if (this.config.dbg.reset_state_on_load) {
            this.session_pointer_key += Math.random().toString();
            this.storage_key += Math.random().toString();
        }
    }

    static async init() {
        const plugin_version = manifest["version"];
        console.log(`tabruh loaded: v${plugin_version}`);

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
            let _ = await this.eventChannel.send({ type: 'tabRemoved', payload: { tabId: tabId as TabId, removeInfo } });
        });
        browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
            let _ = await this.eventChannel.send({ type: 'tabUpdated', payload: { tabId: tabId as TabId, changeInfo, tab } });
        });
        browser.tabs.onMoved.addListener(async (tabId, moveInfo) => {
            let _ = await this.eventChannel.send({ type: 'tabMoved', payload: { tabId: tabId as TabId, moveInfo } });
        });
        browser.tabs.onAttached.addListener(async (tabId, attachInfo) => {
            let _ = await this.eventChannel.send({ type: 'tabAttached', payload: { tabId: tabId as TabId, attachInfo } });
        });
        browser.tabs.onDetached.addListener(async (tabId, detachInfo) => {
            let _ = await this.eventChannel.send({ type: 'tabDetached', payload: { tabId: tabId as TabId, detachInfo } });
        });
        browser.tabs.onActivated.addListener(async (activeInfo) => {
            let _ = await this.eventChannel.send({ type: 'tabActivated', payload: activeInfo });
        });
        browser.windows.onCreated.addListener(async (win) => {
            let _ = await this.eventChannel.send({ type: 'windowCreated', payload: win });
        });
        browser.windows.onRemoved.addListener(async (windowId) => {
            let _ = await this.eventChannel.send({ type: 'windowRemoved', payload: windowId as WindowId });
        });
        browser.windows.onFocusChanged.addListener(async (windowId) => {
            let _ = await this.eventChannel.send({ type: 'windowFocusChanged', payload: windowId as WindowId });
        });
        // browser.sessions.onChanged.addListener(async () => {
        //     const sessions = await browser.sessions.getRecentlyClosed();
        //     if (this.config.dbg.log_sessions) {
        //         console.log(sessions);
        //     }
        // });
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

    // TODO: need to add this check before calling tabs.create anywhere.
    // maybe just create a tab saying "sorry man. can't create this one for you"
    private _isUrlFunny(url_str: string): boolean {
        try {
            const url = new URL(url_str);
            if (url.protocol === "chrome-extension:") {
                return true;
            }
            if (url.protocol === "chrome:") {
                return true;
            }
            if (url.protocol === 'about:') {
                return true;
            }

            return false;
        } catch (e) {
            return true;
        }
    }

    private _getGroupUrl(id: BruhId): string {
        const attrs = this.groupAttrs.get(id)!;
        const params = new URLSearchParams();
        params.set('view', 'group');
        params.set('id', String(id));
        params.set('name', attrs.name);
        params.set('isCustomNamed', String(attrs.isCustomNamed));
        params.set('generation', String(attrs.generation));
        return `${browser.runtime.getURL('overview.html')}?${params.toString()}`;
    }

    private _parseGroupUrlAttrs(url: string): { attrs: GroupAttrs, id: BruhId } | null {
        try {
            const urlObj = new URL(url);
            if (urlObj.protocol === 'moz-extension:' &&
                urlObj.pathname.endsWith('/overview.html') &&
                urlObj.searchParams.get('view') === 'group') {

                const name = urlObj.searchParams.get('name');
                const isCustomNamedStr = urlObj.searchParams.get('isCustomNamed');
                const generationStr = urlObj.searchParams.get('generation');
                const id = parseInt(urlObj.searchParams.get('id')!, 10);

                if (name && isCustomNamedStr && generationStr) {
                    const isCustomNamed = isCustomNamedStr === 'true';
                    const generation = parseInt(generationStr, 10);
                    if (!isNaN(generation)) {
                        return { attrs: { name, isCustomNamed, generation }, id: id as BruhId, };
                    }
                }
            }
        } catch (e) { /* Invalid URL */ }
        return null;
    }

    private _generateUniqueGroupName(): string {
        let name: string;
        const existingNames = new Set(Array.from(this.groupAttrs.values()).map(attr => attr.name));

        do {
            const adj = this.adjectives[Math.floor(Math.random() * this.adjectives.length)];
            const noun = this.nouns[Math.floor(Math.random() * this.nouns.length)];
            name = `${adj} ${noun}`;
        } while (existingNames.has(name));

        return name;
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

    private _logEvent(event: StateManagerEvent) {
        switch (event.type) {
            case 'tabCreated':
            case 'tabRemoved':
            case 'tabMoved':
            case 'tabAttached':
            case 'tabDetached':
            case 'windowCreated':
            case 'windowRemoved':
                console.log(Date.now(), event.type, event.payload);
                break;

            case 'tabActivated':
            case 'tabUpdated':
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
                        console.log(Date.now(), event.type, event.payload.message.type, event.payload.message.payload);
                        break;

                    default:
                        throw utils.exhausted(message);
                }
                break;
            default:
                throw utils.exhausted(event);
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

    async process_events() {
        while (true) {
            const event = await this.eventChannel.wait_recv();
            if (!event) break;

            if (this.config.dbg.log_events) {
                this._logEvent(event);
            }
            await this._process_event(event).catch(console.error);
            this._broadcastUpdates(event);
        }
    }

    get_tab(tid: TabId): TabData {
        if (!this.tabs.has(tid)) throw new Error(`tab with tid: ${tid} does not exist`);
        const tab = this.tabs.get(tid)!;
        if (!this.tree.has(tab.id)) throw new Error(`window node with bid: ${tab.id} tid: ${tid} does not exist`);
        const node = this.tree.get(tab.id)!;
        return { tab: tab, node: node } as TabData;
    }

    get_window(wid: WindowId): WindowData {
        if (!this.windows.has(wid)) throw new Error(`window with wid: ${wid} does not exist`);
        const win = this.windows.get(wid)!;
        if (!this.tree.has(win.id)) throw new Error(`window node with bid: ${win.id} wid: ${wid} does not exist`);
        const node = this.tree.get(win.id)!;
        return { win: win, node: node } as WindowData;
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

    get_tab_node(bid: BruhId) {
        const node = this.get_node(bid);
        if (node.node.type == "window") throw new Error(`node with bid: ${bid} expected type 'tab' | 'group' found 'window'`);
        return this.get_tab(node.node.tid);
    }

    get_window_node(bid: BruhId) {
        const node = this.get_node(bid);
        if (node.node.type != "window") throw new Error(`node with bid: ${bid} expected type 'window' found '${node.node.type}'`);
        return this.get_window(node.node.wid);
    }

    remove_tab(tid: TabId) {
        const tab = this.tabs.get(tid);
        if (!tab) throw new Error(`tab with tid: ${tid} does not exist`);
        this.groupAttrs.delete(tab.id);
        this.tree.delete(tab.id);
        this.tabs.delete(tab.tid);
    }

    remove_window(wid: WindowId) {
        const win = this.windows.get(wid);
        if (!win) throw new Error(`window with wid: ${wid} does not exist`);
        this.groupAttrs.delete(win.id);
        this.tree.delete(win.id);
        this.windows.delete(win.wid);
    }

    remove_node(bid: BruhId) {
        const node = this.tree.get(bid);
        if (!node) throw new Error(`node with bid: ${bid} does not exist`);
        if (node.type == "window") {
            this.remove_window(node.wid);
        } else if (node.type == "tab" || node.type == "group") {
            this.remove_tab(node.tid);
        }
    }

    get_node_name(bid: BruhId): string {
        const node = this.get_node(bid);
        if (node.node.type == "window" || node.node.type == "group") {
            return this.groupAttrs.get(bid)!.name;
        } else {
            return this.get_tab_node(bid).tab.title;
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
                const tab = this.get_tab(tid);

                if (!map.has(tab.node.parentId)) {
                    map.set(tab.node.parentId, []);
                }
                map.get(tab.node.parentId)!.push(tab.tab.id);
            }
        }
        return map;
    }

    private _getOrderedTabList(windowId: WindowId): BruhId[] {
        return this.get_window(windowId).win.tabIds.map(tid => this.get_tab(tid).tab.id);
    }

    private _getAncestors(nodeId: BruhId): BruhId[] {
        const ancestors: BruhId[] = [];
        let current = this.get_node(nodeId).node;
        if (current.type === 'window') {
            return ancestors;
        }

        let parent = this.get_node(current.parentId).node;
        while (parent.type !== 'window') {
            ancestors.push(parent.id);
            parent = this.tree.get(parent.parentId)!;
        }
        // last ancestor is a window
        ancestors.push(parent.id);
        return ancestors;
    }

    private _buildUiStateForRender(windowId: WindowId, rootNodeId?: BruhId): UiStateForRender {
        const win = this.get_window(windowId);

        const childrenMap = this._getChildrenMap();
        const rootIds: BruhId[] = [];
        const uiTree: Map<BruhId, UiNode> = new Map();

        const rootId = rootNodeId || win.win.id;
        let nodeIdsToIterate: BruhId[];
        if (rootNodeId) {
            nodeIdsToIterate = this._getSubtree(rootNodeId).slice(1);
        } else {
            nodeIdsToIterate = this._getOrderedTabList(windowId);
        }

        for (const bruhId of nodeIdsToIterate) {
            const tnode = this.get_tab_node(bruhId);
            const node = tnode.node;
            const tab = tnode.tab;

            uiTree.set(node.id, {
                id: node.id,
                tid: node.tid,
                tab_index: tab.index,
                title: tab.title,
                url: tab.url,
                favIconUrl: tab.favIconUrl,
                isGroup: node.type === 'group',
                isDiscarded: tab.discarded,
                isActive: tab.active,
                isCollapsed: node.collapsed,
                children: childrenMap.get(node.id) || [],
            });

            if (node.parentId === rootId) {
                rootIds.push(node.id);
            }
        }

        const rootNode = this.get_node(rootId);
        const attrs = this.groupAttrs.get(rootNode.node.id)!;
        const isClosed = (rootNode.node.type === 'window') ? this.get_window(rootNode.node.wid).win.closed : this.get_tab(rootNode.node.tid).tab.closed;

        return {
            id: rootNode.node.id,
            windowId: win.win.wid,
            name: attrs.name,
            isCustomNamed: attrs.isCustomNamed,
            isClosed: isClosed,
            generation: attrs.generation,
            tree: uiTree,
            tabsById: new Map(this.tabs.entries()),
            rootIds,
        };
    }

    private _addTabToWindow(tid: TabId, wid: WindowId, index: number): void {
        const { win } = this.get_window(wid);
        // Ensure we don't have duplicates
        const existingIndex = win.tabIds.indexOf(tid);
        if (existingIndex > -1) {
            win.tabIds.splice(existingIndex, 1);
        }

        win.tabIds.splice(index, 0, tid);
        this.get_tab(tid).tab.wid = wid; // Also update the tab's own window reference

        this._reindexWindowTabs(wid); // Re-index all tabs in the window
    }

    private _removeTabFromWindow(tid: TabId, wid: WindowId): void {
        const { win } = this.get_window(wid);
        const index = win.tabIds.indexOf(tid);
        if (index > -1) {
            win.tabIds.splice(index, 1);
        }

        this._reindexWindowTabs(wid); // Re-index remaining tabs in the window
    }

    private _reindexWindowTabs(wid: WindowId): void {
        const { win } = this.get_window(wid);
        for (let i = 0; i < win.tabIds.length; i++) {
            const tid = win.tabIds[i]!;
            if (this.tabs.has(tid)) {
                this.get_tab(tid).tab.index = i;
            }
        }
    }

    private _incrementHgid(): HierarchyGenerationId {
        return ++this.hierarchy_generation_id as HierarchyGenerationId;
    }

    private _getNodeStorageData(bruhId: BruhId): NodeStorageData {
        const { node } = this.get_node(bruhId);
        const childrenIds = this._getChildrenMap().get(bruhId) || [];
        const ancestorIds = this._getAncestors(bruhId);

        const storageData: NodeStorageData = {
            bruhId: bruhId,
            hgid: node.hgid,
            collapsed: node.collapsed,
            type: node.type,
            parentId: node.type === 'window' ? (0 as BruhId) : node.parentId,
            ancestorIds: ancestorIds,
            childrenIds: childrenIds,
            // @ts-ignore
            groupAttrs: (node.type === 'group' || node.type === 'window') ? this.groupAttrs.get(bruhId) : undefined,
            // @ts-ignore
            index: node.type == "window" ? undefined : this.get_tab_node(bruhId).tab.index,
        };

        return storageData as NodeStorageData;
    }

    private _setNodeClosedState(bruhId: BruhId, isClosed: boolean): void {
        const subtreeIds = this._getSubtree(bruhId);
        for (const id of subtreeIds) {
            const { node } = this.get_node(id);
            if (node.type === 'window') {
                this.get_window(node.wid).win.closed = isClosed;
            } else {
                this.get_tab(node.tid).tab.closed = isClosed;
            }
        }
    }

    private _archiveNode(bruhId: BruhId): void {
        const { node } = this.get_node(bruhId);
        node.hgid = this._incrementHgid();
        const snapshot = this._getNodeStorageData(bruhId);
        this.browserRestoreCache.set(bruhId, snapshot);
        this._setNodeClosedState(bruhId, true);

        if (node.type === 'window') {
            this.get_window(node.wid).win.isArchivedPristine = true;
        }
    }

    private async _moveNode(bruhId: BruhId, newParentId: BruhId, index: number): Promise<void> {
        const { node: sourceNode } = this.get_node(bruhId);
        const { node: targetParentNode } = this.get_node(newParentId);

        const sourceIsClosed = sourceNode.type === 'window' ? this.get_window(sourceNode.wid).win.closed : this.get_tab(sourceNode.tid).tab.closed;
        const targetIsClosed = targetParentNode.type === 'window' ? this.get_window(targetParentNode.wid).win.closed : this.get_tab(targetParentNode.tid).tab.closed;

        const sourceRootWindowId = sourceNode.type === 'window' ? sourceNode.id : this._getAncestors(bruhId).slice(-1)[0];
        const targetRootWindowId = targetParentNode.type === 'window' ? targetParentNode.id : this._getAncestors(newParentId).slice(-1)[0];

        // Case: Dead -> Dead
        if (sourceIsClosed && targetIsClosed) {
            this._setParent(bruhId, newParentId);
            if (sourceRootWindowId) this.get_window_node(sourceRootWindowId).win.isArchivedPristine = false;
            if (targetRootWindowId) this.get_window_node(targetRootWindowId).win.isArchivedPristine = false;
        }
        // Case: Live -> Dead
        else if (!sourceIsClosed && targetIsClosed) {
            const subtreeIds = this._getSubtree(bruhId);
            const tidsToRemove = subtreeIds.map(id => this.get_tab_node(id).tab.tid);
            this._setParent(bruhId, newParentId);
            for (const id of subtreeIds) {
                this._archiveNode(id);
            }
            if (sourceRootWindowId) this.get_window_node(sourceRootWindowId).win.isArchivedPristine = false;
            if (targetRootWindowId) this.get_window_node(targetRootWindowId).win.isArchivedPristine = false;
            await browser.tabs.remove(tidsToRemove);
        }
        // Case: Dead -> Live
        else if (sourceIsClosed && !targetIsClosed) {
            this._setParent(bruhId, newParentId);
            const subtreeIds = this._getSubtree(bruhId);
            const targetWid = this.get_window_node(targetRootWindowId!).win.wid;
            for (const id of subtreeIds) {
                const nodeData = this.get_tab_node(id);
                const newTab = await browser.tabs.create({
                    url: nodeData.tab.url,
                    index,
                    windowId: targetWid,
                    active: false,
                    discarded: true,
                    title: this.get_node_name(nodeData.node.id),
                });
                nodeData.tab.tid = newTab.id! as TabId;
                this._addTabToWindow(newTab.id! as TabId, targetWid, newTab.index);
                await this._writeSessionPointer(id, newTab.id! as TabId, 'tab');
                index++;
            }
            this._setNodeClosedState(bruhId, false);
            if (sourceRootWindowId) this.get_window_node(sourceRootWindowId).win.isArchivedPristine = false;
        }
        // Case: Live -> Live
        else {
            await this._reparentNode(bruhId, newParentId, index);
        }
    }

    private async _cloneNode(originalNodeId: BruhId, newParentId: BruhId, windowId: WindowId): Promise<void> {
        const originalNodeData = this.get_node(originalNodeId);
        const originalTab = originalNodeData.node.type !== 'window' ? (originalNodeData as TabData).tab : null;

        const newBruhId = this.bruhid++ as BruhId;
        const newTab = await browser.tabs.create({
            windowId,
            url: originalTab?.url,
            active: false,
            discarded: true,
            title: this.get_node_name(originalNodeData.node.id),
        });

        const node: Extract<Node, { type: "tab" | "group" }> = {
            id: newBruhId,
            hgid: this._incrementHgid(),
            parentId: newParentId,
            collapsed: originalNodeData.node.collapsed,
            type: originalNodeData.node.type as 'tab' | 'group',
            tid: newTab.id! as TabId,
        };

        const bruhTab: BruhTab = {
            id: newBruhId,
            tid: newTab.id! as TabId,
            wid: windowId,
            index: newTab.index,
            url: newTab.url || "",
            title: originalTab?.title || "",
            favIconUrl: originalTab?.favIconUrl,
            discarded: newTab.discarded ?? false,
            active: newTab.active,
            closed: false,
        };

        if (node.type === 'group') {
            this.groupAttrs.set(newBruhId, { ...this.groupAttrs.get(originalNodeId)! });
        }

        this.tree.set(newBruhId, node);
        this.tabs.set(newTab.id! as TabId, bruhTab);
        await this._writeSessionPointer(newBruhId, newTab.id! as TabId, 'tab');
        this._addTabToWindow(newTab.id! as TabId, windowId, newTab.index);

        const children = this._getChildrenMap().get(originalNodeId) || [];
        for (const childId of children) {
            await this._cloneNode(childId, newBruhId, windowId);
        }
    }

    private async _restoreUI(bruhId: BruhId): Promise<void> {
        const originalWindowData = this.get_window_node(bruhId);
        const newBrowserWindow = await browser.windows.create({});
        const newWindowData = await this._createWindowNode(newBrowserWindow.id! as WindowId);

        this.groupAttrs.set(newWindowData.node.id, { ...this.groupAttrs.get(bruhId)! });

        const children = this._getChildrenMap().get(bruhId) || [];
        for (const childId of children) {
            await this._cloneNode(childId, newWindowData.node.id, newWindowData.win.wid);
        }

        // the corresponding adding/removal from window state is done in the resp. browser events.
        await browser.tabs.remove(newBrowserWindow.tabs![0]!.id!);

        // TODO: better to forget this extra tab ever existed. else it is annoying to have it restored when trying to restore something else.
        // browser.sessions.getRecentlyClosed()

        const originalSubtree = this._getSubtree(bruhId);
        for (const id of originalSubtree) {
            this.remove_node(id);
        }
    }

    private async _createOrRestoreWindow(wid: WindowId): Promise<WindowData> {
        // If the window is already live in our state, there's nothing to do.
        if (this.windows.has(wid) && !this.get_window(wid).win.closed) {
            return this.get_window(wid);
        }

        const bruhId = await this._readSessionPointer(wid, 'window');

        // This is a browser restore if we find a bruhId.
        if (bruhId) {
            const cacheData = this.browserRestoreCache.get(bruhId) as Extract<NodeStorageData, { type: "window" | "group" }>;
            // If we have a cache entry, this is a true resurrection.
            if (cacheData) {
                const existingNodeData = this.tree.has(bruhId) ? this.get_window_node(bruhId) : null;
                const isPristine = existingNodeData?.win.isArchivedPristine ?? false;

                // The user hasn't edited the closed session, so we can resurrect it seamlessly.
                if (existingNodeData && isPristine) {
                    const { node, win: bruhWin } = existingNodeData;
                    const oldWid = bruhWin.wid;

                    // Update the state with the new, live window ID and mark as live.
                    bruhWin.closed = false;
                    bruhWin.isArchivedPristine = true;
                    bruhWin.wid = wid;
                    // bruhWin.tabIds = [];
                    node.wid = wid;

                    // Move the entry in the `windows` map from the old ID to the new ID.
                    this.windows.set(wid, bruhWin);
                    if (oldWid !== wid) {
                        this.windows.delete(oldWid);
                    }

                    // The window is now live, so we can clear its entry from the restore cache.
                    this.browserRestoreCache.delete(bruhId);
                    return { node, win: bruhWin };
                }
            }
            // If the session was NOT pristine, or if we have a pointer but no state (e.g., user deleted it),
            // we must treat this as a new window creation but force it to adopt the old bruhId.
            // This prevents creating a duplicate window if the user edits a session then restores the original.
            const node: Extract<Node, { type: "window" }> = {
                id: bruhId,
                hgid: this._incrementHgid(),
                parentId: 0 as BruhId & 0,
                collapsed: false,
                type: "window",
                wid: wid,
            };

            const bruhWin: BruhWindow = {
                id: bruhId,
                wid: wid,
                tabIds: [],
                closed: false,
            };

            const attrs = cacheData?.groupAttrs || { name: this._generateUniqueGroupName(), generation: bruhId, isCustomNamed: false };
            this.groupAttrs.set(bruhId, attrs);

            this.tree.set(bruhId, node);
            this.windows.set(wid, bruhWin);
            await this._writeSessionPointer(bruhId, wid, 'window');
            this.browserRestoreCache.delete(bruhId); // Clear the cache entry.
            return { node, win: bruhWin };
        }

        // This is a genuinely new window with no history.
        return await this._createWindowNode(wid);
    }

    private async _createOrRestoreTab(bruhId: BruhId, browserTab: browser.Tabs.Tab): Promise<void> {
        const cacheData = this.browserRestoreCache.get(bruhId) as Exclude<NodeStorageData, { type: "window" }>;
        if (!cacheData) {
            // This tab was not in our cache, so treat it as entirely new.
            await this._createTabNode(browserTab, { id: bruhId });
            return;
        }

        const existingNodeData = this.tree.has(bruhId) ? this.get_node(bruhId) : null;
        let isPristine = false;
        if (existingNodeData) {
            // Find the root window of the existing closed node to check its pristine status.
            const rootId = this._getAncestors(bruhId).pop() || bruhId;
            const rootNode = this.get_node(rootId).node;
            if (rootNode.type === 'window') {
                isPristine = this.get_window(rootNode.wid).win.isArchivedPristine ?? false;
            }
        }

        if (existingNodeData && isPristine) {
            // --- SEAMLESS RESURRECTION ---
            this._setNodeClosedState(bruhId, false);
            const tabData = this.get_tab_node(bruhId);
            const newTid = browserTab.id! as TabId;
            const newWid = browserTab.windowId! as WindowId;

            // CRITICAL FIX 1: Capture the old placeholder tid BEFORE mutating the object.
            const oldTid = tabData.tab.tid;

            // Update the BruhTab object with its new live properties.
            tabData.tab.tid = newTid;
            tabData.node.tid = newTid;
            tabData.tab.wid = newWid;
            tabData.tab.index = browserTab.index;

            // CRITICAL FIX 2: Update the maps. Remove the old placeholder key, add the new live key.
            this.tabs.set(newTid, tabData.tab);
            this.tabs.delete(oldTid);

            // CRITICAL FIX 3: Find the old placeholder tid in the parent window's list and replace it.
            const parentWindow = this.get_window(newWid).win;
            const tabIndexInWindow = parentWindow.tabIds.indexOf(oldTid);
            if (tabIndexInWindow > -1) {
                parentWindow.tabIds[tabIndexInWindow] = newTid;
            }

            // Write the session pointer and clear the cache entry for this now-live node.
            await this._writeSessionPointer(bruhId, newTid, 'tab');
            this.browserRestoreCache.delete(bruhId);

        } else {
            // --- NON-PRISTINE RESTORE or ORPHANED RESTORE ---
            // The user has edited the session, so we restore this tab as a new entity
            // but ensure it reclaims its original BruhId.
            this.browserRestoreCache.delete(bruhId);

            await this._createTabNode(browserTab, { id: bruhId });
        }

        // reparent the restored tab.
        if (this.tree.has(cacheData.parentId)) {
            await this._reparentNode(bruhId, cacheData.parentId, cacheData.index);
        }

        // --- CHILD RECLAMATION (for both cases) ---
        for (const childId of cacheData.childrenIds) {
            if (this.tree.has(childId)) {
                const childNode = this.get_tab_node(childId).node;
                // TODO: hgid is broken everywhere else.
                //  we need to change it every time we rebase a child to a different parent, but only when done intentionally by user
                if (childNode.hgid <= cacheData.hgid) {
                    this._setParent(childId, bruhId);
                }
            }
        }
    }

    private async _createTabNode(tab: browser.Tabs.Tab, options?: { id?: BruhId }): Promise<TabData> {
        const tid = tab.id as TabId;
        const wid = tab.windowId as WindowId;
        let parentId: BruhId;

        if (tab.openerTabId !== undefined && this.tabs.has(tab.openerTabId as TabId)) {
            parentId = this.get_tab(tab.openerTabId as TabId).tab.id;
        } else {
            parentId = this.get_window(wid).win.id;
        }

        const isGroup = this._isGroupTab(tab);
        const urlParsed = isGroup ? this._parseGroupUrlAttrs(tab.url!) : null;
        // if url has an id, always ignore it. (this function is for creating new tabs)
        const urlBruhId = urlParsed?.id;

        let bruhId: BruhId = options?.id ?? this.bruhid++ as BruhId;

        const node: Extract<Node, { type: "tab" | "group" }> = {
            id: bruhId,
            hgid: this._incrementHgid(),
            parentId: parentId,
            collapsed: false,
            type: isGroup ? "group" : "tab",
            tid: tid,
        };

        const bruhTab: BruhTab = {
            id: bruhId,
            tid: tid,
            wid: wid,
            index: tab.index,
            url: tab.url || "",
            title: tab.title || "",
            favIconUrl: tab.favIconUrl,
            discarded: tab.discarded ?? false,
            active: tab.active,
            closed: false,
        };

        if (isGroup) {
            const attrs: GroupAttrs = urlParsed?.attrs ? urlParsed.attrs : {
                name: this._generateUniqueGroupName(),
                generation: bruhId,
                isCustomNamed: false,
            };
            this.groupAttrs.set(bruhId, attrs);
            bruhTab.title = attrs.name;
        }

        this.tree.set(bruhId, node);
        this.tabs.set(tid, bruhTab);
        await this._writeSessionPointer(bruhId, tid, 'tab');

        if (isGroup) {
            const correctUrl = this._getGroupUrl(bruhId);
            bruhTab.url = correctUrl;
            await browser.tabs.update(tid, { url: correctUrl });
        }

        return { node, tab: bruhTab };
    }

    private async _createWindowNode(wid: WindowId): Promise<WindowData> {
        const bruhId = this.bruhid++ as BruhId;

        const node: Extract<Node, { type: "window" }> = {
            id: bruhId,
            hgid: this._incrementHgid(),
            parentId: 0 as BruhId & 0,
            collapsed: false,
            type: "window",
            wid: wid,
        };

        const bruhWin: BruhWindow = {
            id: bruhId,
            wid: wid,
            tabIds: [],
            closed: false,
        };

        const attrs: GroupAttrs = { name: this._generateUniqueGroupName(), generation: bruhId, isCustomNamed: false };
        this.groupAttrs.set(bruhId, attrs);

        this.tree.set(bruhId, node);
        this.windows.set(wid, bruhWin);
        await this._writeSessionPointer(bruhId, wid, 'window');
        return { node, win: bruhWin };
    }

    private _removeNodeAndReparentChildren(bruhId: BruhId): void {
        const { node: nodeToRemove } = this.get_node(bruhId);
        const parentId = nodeToRemove.parentId;

        const children = this._getChildrenMap().get(bruhId) || [];
        for (const childId of children) {
            this._setParent(childId, parentId);
        }
        this.remove_node(bruhId);
    }

    private async _reparentNode(nodeId: BruhId, newParentId: BruhId, index: number): Promise<void> {
        const { node: nodeToMove } = this.get_tab_node(nodeId);
        this._setParent(nodeId, newParentId);

        const { node: newParentNode } = this.get_node(newParentId);
        const targetWindowId = newParentNode.type === 'window'
            ? newParentNode.wid
            : this.get_tab_node(newParentNode.id).tab.wid;

        await browser.tabs.move(nodeToMove.tid, { windowId: targetWindowId, index });
    }

    private _setParent(childId: BruhId, newParentId: BruhId): void {
        const { node: childNode } = this.get_tab_node(childId);
        childNode.parentId = newParentId;
    }

    private async _updateTabStateFromBrowser(tid: TabId, tab: browser.Tabs.Tab): Promise<void> {
        const { tab: bruhTab, node } = this.get_tab(tid);

        bruhTab.wid = tab.windowId as WindowId;
        bruhTab.index = tab.index;
        bruhTab.url = tab.url || "";
        bruhTab.title = tab.title || "";
        bruhTab.favIconUrl = tab.favIconUrl;
        bruhTab.discarded = tab.discarded ?? false;
        bruhTab.active = tab.active;
        bruhTab.closed = false;

        const isGroupNow = tab.url == "about:blank" ? node.type == "group" : this._isGroupTab(tab);
        // TODO: if the url of the tab has group attrs, try restoring the attrs. maybe it's id == this tab's id
        if (isGroupNow && node.type === 'tab') {
            node.type = 'group';
            if (!this.groupAttrs.has(bruhTab.id)) {
                this.groupAttrs.set(bruhTab.id, { name: this._generateUniqueGroupName(), generation: bruhTab.id, isCustomNamed: false });
            }
            bruhTab.title = this.groupAttrs.get(bruhTab.id)!.name;
        } else if (!isGroupNow && node.type === 'group') {
            node.type = 'tab';
            this.groupAttrs.delete(node.id);
        }

        if (isGroupNow) {
            const urlParsed = this._parseGroupUrlAttrs(bruhTab.url);
            if (urlParsed && urlParsed.id !== bruhTab.id) {
                const correctUrl = this._getGroupUrl(bruhTab.id);
                bruhTab.url = correctUrl;
                await browser.tabs.update(tid, { url: correctUrl });
            }
        }
    }

    private async _flattenNode(nodeId: BruhId, recursive: boolean): Promise<void> {
        const { node } = this.get_tab_node(nodeId);
        const parentId = node.parentId;
        const nodesToMove = recursive ? this._getSubtree(nodeId).slice(1) : (this._getChildrenMap().get(nodeId) || []);
        for (const childId of nodesToMove) {
            this._setParent(childId, parentId);
        }
    }

    private async _moveSubtreeToNewWindow(rootNodeId: BruhId): Promise<void> {
        const rootNodeData = this.get_node(rootNodeId);
        if (rootNodeData.node.type === 'window') return;
        if (rootNodeData.node.type == "group") {
            await this._convertGroupToWindow(rootNodeId);
            return;
        }

        const subtreeIds = this._getSubtree(rootNodeId);
        const tidsToMove = subtreeIds
            .map(id => this.get_tab_node(id).tab.tid);

        const rootTabTid = tidsToMove[0];

        const newBrowserWindow = await browser.windows.create();
        const extraTabId = newBrowserWindow.tabs![0]!.id! as TabId;
        const newWindowId = newBrowserWindow.id! as WindowId;

        if (!this.windows.has(newWindowId)) {
            await this._createWindowNode(newWindowId);
        }
        const newWindowData = this.get_window(newWindowId);

        await browser.tabs.move(tidsToMove, { windowId: newWindowId, index: 0 });

        await browser.tabs.update(rootTabTid, { active: true });
        await browser.tabs.remove(extraTabId);

        this._setParent(rootNodeId, newWindowData.node.id);
    }

    private async _convertGroupToWindow(groupId: BruhId): Promise<void> {
        const groupData = this.get_tab_node(groupId);
        const groupAttrs = this.groupAttrs.get(groupId)!;
        const childrenIds = this._getChildrenMap().get(groupId) || [];
        const tidsToMove = childrenIds.map(id => this.get_tab_node(id).tab.tid);

        const newBrowserWindow = await browser.windows.create();
        const extraTabId = newBrowserWindow.tabs![0]!.id! as TabId;
        const newWindowId = newBrowserWindow.id! as WindowId;

        if (tidsToMove.length > 0) {
            await browser.tabs.move(tidsToMove, { windowId: newWindowId, index: 0 });
            await browser.tabs.update(tidsToMove[0], { active: true });
        }

        await browser.tabs.remove(extraTabId);

        // TODO: broken
        await browser.tabs.remove(groupData.tab.tid);

        const newWindowData = await this._createWindowNode(newWindowId);
        this.groupAttrs.set(newWindowData.node.id, { ...groupAttrs });

        for (const childId of childrenIds) {
            this._setParent(childId, newWindowData.node.id);
        }
    }

    private async _convertWindowToGroup(sourceBruhId: BruhId, targetParentId: BruhId, targetWindowId: WindowId, index: number): Promise<void> {
        const sourceWindowData = this.get_window_node(sourceBruhId);
        const sourceWindowId = sourceWindowData.win.wid;
        const isSourceWindowOpen = this.windows.has(sourceWindowId) && !sourceWindowData.win.closed;
        const sourceGroupAttrs = this.groupAttrs.get(sourceBruhId)!;

        const childBruhIds = this._getSubtree(sourceBruhId).splice(1);
        const childTids = childBruhIds.map(bid => this.get_tab_node(bid).tab.tid);

        const newGroupUrl = this._getGroupUrl(sourceBruhId);
        const newGroupBrowserTab = await browser.tabs.create({
            windowId: targetWindowId,
            index: index,
            url: newGroupUrl,
            active: false,
            discarded: true,
            title: sourceGroupAttrs.name,
        });
        const newGroupTid = newGroupBrowserTab.id! as TabId;

        if (isSourceWindowOpen && childTids.length > 0) {
            await browser.tabs.move(childTids, { windowId: targetWindowId, index: index + 1 });

            // for (let i = 0; i < childTids.length; i++) {
            //     let tid = childTids[i];
            //     sourceWindowData.win.tabIds.splice(index + i + 1, 0, newGroupBrowserTab.id as TabId);
            // }
        }

        const nodeToMorph = sourceWindowData.node as unknown as Extract<Node, { type: "tab" | "group" }>;
        nodeToMorph.type = 'group';
        nodeToMorph.parentId = targetParentId;
        nodeToMorph.tid = newGroupTid;
        nodeToMorph.collapsed = false;

        const newBruhTab: BruhTab = {
            id: sourceBruhId,
            tid: newGroupTid,
            wid: targetWindowId,
            index: index,
            url: newGroupUrl,
            title: sourceGroupAttrs.name,
            favIconUrl: undefined,
            discarded: true,
            active: false,
            closed: false,
        };
        this.tabs.set(newGroupTid, newBruhTab);
        this.windows.delete(sourceWindowId);

        // Add the new group tab and all moved child tabs to the target window's list
        const { win: targetWin } = this.get_window(targetWindowId);
        const tidsToInsert = [newGroupTid, ...childTids];
        targetWin.tabIds.splice(index, 0, ...tidsToInsert);

        this._reindexWindowTabs(targetWindowId); // Re-index the target window

        for (const childId of childBruhIds) {
            const childData = this.get_tab_node(childId);
            childData.tab.wid = targetWindowId;
        }

        await this._writeSessionPointer(sourceBruhId, newGroupTid, 'tab');
    }

    private async _saveState(): Promise<void> {
        const nodeStorage: Record<string, NodeStorageData> = {};
        const childrenMap = this._getChildrenMap();

        for (const [bruhId, node] of this.tree.entries()) {
            const storageNode: NodeStorageData = {
                bruhId: bruhId,
                hgid: node.hgid,
                collapsed: node.collapsed,
                type: node.type,
                parentId: node.type === 'window' ? (0 as BruhId) : node.parentId,
                ancestorIds: this._getAncestors(bruhId),
                childrenIds: childrenMap.get(bruhId) || [],
                // @ts-ignore
                groupAttrs: (node.type === 'group' || node.type === 'window') ? this.groupAttrs.get(bruhId) : undefined,
            };
            nodeStorage[bruhId] = storageNode as NodeStorageData;
        }

        const cacheStorage: Record<string, NodeStorageData> = {};
        for (const [bruhId, nodeData] of this.browserRestoreCache.entries()) {
            cacheStorage[bruhId] = nodeData;
        }

        const stateToSave: StorageState = {
            bruhid: this.bruhid,
            hgid: this.hierarchy_generation_id,
            nodes: nodeStorage,
            browserRestoreCache: cacheStorage,
        };
        await browser.storage.local.set({ [this.storage_key]: stateToSave });
    }

    private async _loadState(): Promise<void> {
        const result = await browser.storage.local.get(this.storage_key);
        const savedState = result[this.storage_key] as StorageState;
        if (!savedState) return;

        this.bruhid = savedState.bruhid;
        this.hierarchy_generation_id = savedState.hgid;

        const nodes = savedState.nodes;
        for (const bruhIdStr in nodes) {
            const bruhId = Number(bruhIdStr) as BruhId;
            const storageNode = nodes[bruhIdStr]!;

            // TODO: wid and tid are not saved, and can't save. what dodo
            if (storageNode.type === 'window') {
                const wid = -bruhId as WindowId;
                this.tree.set(bruhId, {
                    id: bruhId,
                    type: 'window',
                    wid: wid,
                    parentId: 0 as BruhId & 0,
                    hgid: storageNode.hgid,
                    collapsed: false,
                });
                this.windows.set(wid, { id: bruhId, wid: wid, tabIds: [], closed: true });
                this.groupAttrs.set(bruhId, storageNode.groupAttrs);
            } else {
                const tid = -bruhId as TabId;
                this.tree.set(bruhId, {
                    id: bruhId,
                    type: storageNode.type,
                    tid: tid,
                    parentId: storageNode.parentId,
                    hgid: storageNode.hgid,
                    collapsed: storageNode.collapsed,
                });
                // TODO: stored state does not have url? :mous
                this.tabs.set(tid, {
                    id: bruhId,
                    tid: tid,
                    wid: -1 as WindowId,
                    index: -1,
                    url: "",
                    title: "",
                    active: false,
                    discarded: true,
                    closed: true,
                });
                if (storageNode.type === 'group') {
                    this.groupAttrs.set(bruhId, storageNode.groupAttrs);
                }
            }
        }

        if (savedState.browserRestoreCache) {
            const cacheStorage = savedState.browserRestoreCache;
            for (const bruhIdStr in cacheStorage) {
                const bruhId = Number(bruhIdStr) as BruhId;
                this.browserRestoreCache.set(bruhId, cacheStorage[bruhIdStr]!);
            }
        }
    }

    private async _writeSessionPointer(bruhId: BruhId, id: TabId | WindowId, type: 'tab' | 'window'): Promise<void> {
        const data = { bruhId };
        try {
            if (type === 'tab') {
                await browser.sessions.setTabValue(id as TabId, this.session_pointer_key, data);
            } else {
                await browser.sessions.setWindowValue(id as WindowId, this.session_pointer_key, data);
            }
        } catch (e) {
            console.warn(`Could not set session pointer for ${type} ${id}:`, e);
        }
    }

    private async _readSessionPointer(id: TabId | WindowId, type: 'tab' | 'window'): Promise<BruhId | undefined> {
        try {
            let data: any;
            if (type === 'tab') {
                data = await browser.sessions.getTabValue(id as TabId, this.session_pointer_key);
            } else {
                data = await browser.sessions.getWindowValue(id as WindowId, this.session_pointer_key);
            }
            return data?.bruhId;
        } catch (e) {
            return undefined;
        }
    }

    async init_tree() {
        // TODO: kinda broken
        // await this._loadState();
        const liveWindows = await browser.windows.getAll({ populate: true, windowTypes: ['normal'] });
        const hydratedBruhIds = new Set<BruhId>();

        for (const win of liveWindows) {
            if (win.id === undefined) continue;
            const wid = win.id as WindowId;
            const bruhId = await this._readSessionPointer(wid, 'window');

            if (bruhId && this.tree.has(bruhId)) {
                hydratedBruhIds.add(bruhId);
                const winData = this.get_window(wid);
                winData.win.closed = false;
                winData.win.tabIds = (win.tabs ?? []).map(t => t.id as TabId);
            } else {
                const winData = await this._createWindowNode(wid);
                winData.win.closed = false;
                winData.win.tabIds = (win.tabs ?? []).map(t => t.id as TabId);
            }
        }

        for (const win of liveWindows) {
            for (const tab of win.tabs ?? []) {
                if (!tab.id) continue;
                const tid = tab.id as TabId;
                const bruhId = await this._readSessionPointer(tid, 'tab');

                if (bruhId && this.tree.has(bruhId)) {
                    hydratedBruhIds.add(bruhId);
                    await this._updateTabStateFromBrowser(tid, tab);
                } else {
                    await this._createTabNode(tab, { id: bruhId });
                }
            }
        }

        // TODO: what's this stupid stuff?
        // for (const bruhId of this.tree.keys()) {
        //     if (!hydratedBruhIds.has(bruhId)) {
        //         this._setNodeClosedState(bruhId, true);
        //     }
        // }
    }

    async _process_event(event: StateManagerEvent) {
        switch (event.type) {
            case 'tabCreated': {
                const tab = event.payload;
                if (!tab.id || !tab.windowId) return;
                if (this.tabs.has(tab.id as TabId)) return;
                if (!this.windows.has(tab.windowId as WindowId)) {
                    await this._createOrRestoreWindow(tab.windowId as WindowId);
                }

                const bruhId = await this._readSessionPointer(tab.id as TabId, 'tab');
                if (bruhId) {
                    await this._createOrRestoreTab(bruhId, tab);
                } else {
                    await this._createTabNode(tab);
                }

                this._addTabToWindow(tab.id as TabId, tab.windowId as WindowId, tab.index);
            } break;
            case 'tabRemoved': {
                const { tabId, removeInfo } = event.payload;
                if (!this.tabs.has(tabId)) return;

                if (removeInfo.isWindowClosing) {
                    // This is part of a window close. Just track the tab ID.
                    // The final decision will be made in the windowRemoved event.
                    if (!this.closing_window_tabs.has(removeInfo.windowId as WindowId)) {
                        this.closing_window_tabs.set(removeInfo.windowId as WindowId, new Set());
                    }
                    this.closing_window_tabs.get(removeInfo.windowId as WindowId)!.add(tabId);
                } else {
                    const tabData = this.get_tab(tabId);
                    this._archiveNode(tabData.node.id);

                    // Remove it from its parent window's list of tabs.
                    this._removeTabFromWindow(tabId, tabData.tab.wid);

                    // Permanently remove the node from the main tree and reparent its children.
                    this._removeNodeAndReparentChildren(tabData.tab.id);
                }
            } break;
            case 'tabUpdated': {
                const { tabId, tab } = event.payload;
                if (!this.tabs.has(tabId)) return;
                await this._updateTabStateFromBrowser(tabId, tab);
            } break;
            case 'tabMoved': {
                const { tabId, moveInfo } = event.payload;
                const wid = moveInfo.windowId as WindowId;
                const win = this.get_window(wid).win;
                const [movedTabId] = win.tabIds.splice(moveInfo.fromIndex, 1);
                win.tabIds.splice(moveInfo.toIndex, 0, movedTabId!);
                this._reindexWindowTabs(wid);
            } break;
            case 'tabAttached': {
                const { tabId, attachInfo } = event.payload;
                this._addTabToWindow(tabId, attachInfo.newWindowId as WindowId, attachInfo.newPosition);
            } break;
            case 'tabDetached': {
                const { tabId, detachInfo } = event.payload;
                this._removeTabFromWindow(tabId, detachInfo.oldWindowId as WindowId);
            } break;
            case 'tabActivated': {
                const { tabId, windowId } = event.payload;
                const win = this.get_window(windowId as WindowId).win;
                for (const tid of win.tabIds) {
                    const tab = this.get_tab(tid).tab;
                    tab.active = (tid === tabId);
                }
            } break;
            case 'windowCreated': {
                const win = event.payload;
                if (win.id === undefined || this.windows.has(win.id as WindowId)) return;
                await this._createOrRestoreWindow(win.id as WindowId);
            } break;
            case 'windowRemoved': {
                const windowId = event.payload;
                if (!this.windows.has(windowId)) return;
                const winData = this.get_window(windowId);

                if (this.closing_window_tabs.has(windowId)) {
                    const closedTabs = this.closing_window_tabs.get(windowId)!;
                    this.closing_window_tabs.delete(windowId);

                    if (closedTabs.size <= 1) {
                        // This was a single-tab window close, treat as permanent removal.
                        const subtreeIds = this._getSubtree(winData.win.id);
                        for (const id of subtreeIds) {
                            this.remove_node(id);
                        }
                    }

                    const subtreeIds = this._getSubtree(winData.win.id);
                    for (const id of subtreeIds) {
                        this._archiveNode(id);
                    }
                } else {
                    // The window was removed without preceding tabRemoved events (e.g., via another extension).
                    // Safest action is to treat it as restorable.
                    this._archiveNode(winData.win.id);
                }
            } break;
            case 'windowFocusChanged': { } break;
            case 'portMessage': {
                const port = event.payload.port;
                const message = event.payload.message;
                switch (message.type) {
                    case 'GET_STATE_FOR_WINDOW': {
                        const state = this._buildUiStateForRender(message.payload.windowId);
                        this._post(port, { type: 'STATE_UPDATE', payload: { state } });
                    } break;
                    case 'GET_STATE_FOR_GROUP_VIEW': {
                        const rootNode = this.get_tab_node(message.payload.nodeId);
                        const state = this._buildUiStateForRender(rootNode.tab.wid, message.payload.nodeId);
                        this._post(port, { type: 'STATE_UPDATE', payload: { state } });
                    } break;
                    case 'GET_ALL_WINDOW_STATES': {
                        const states = Array.from(this.windows.values())
                            .map(w => this._buildUiStateForRender(w.wid));
                        this._post(port, { type: 'ALL_STATES_UPDATE', payload: { states } });
                    } break;
                    case 'TOGGLE_COLLAPSE': {
                        const node = this.get_tab_node(message.payload.nodeId).node;
                        node.collapsed = !node.collapsed;
                    } break;
                    case 'HANDLE_DROP': {
                        const { dragData, targetNodeId, action, targetWindowId } = message.payload;
                        const { node: targetNode } = this.get_node(targetNodeId);
                        const { node: draggedNode } = this.get_node(dragData.draggedNodeId);

                        draggedNode.hgid = this._incrementHgid();

                        // Special case: a dead or live window is dropped into a live window, converting it to a group
                        if (draggedNode.type === 'window' && !this.get_window(targetWindowId).win.closed) {
                            const orderedTabs = this._getOrderedTabList(targetWindowId);
                            const lastDescendantId = this._getSubtree(targetNodeId).pop()!;
                            const lastDescendantNode = this.tree.get(lastDescendantId);
                            const lastDescendantIndex = lastDescendantNode && lastDescendantNode.type !== 'window' ? orderedTabs.indexOf(this.get_tab_node(lastDescendantId).tab.id) : -1;

                            let newParentId: BruhId;
                            let index: number;

                            switch (action) {
                                case 'above':
                                    newParentId = (targetNode as Extract<Node, { type: 'tab' | 'group' }>).parentId;
                                    index = orderedTabs.indexOf(targetNodeId);
                                    break;
                                case 'below':
                                    newParentId = (targetNode as Extract<Node, { type: 'tab' | 'group' }>).parentId;
                                    index = lastDescendantIndex > -1 ? lastDescendantIndex + 1 : orderedTabs.length;
                                    break;
                                case 'root':
                                    newParentId = targetNodeId;
                                    index = orderedTabs.length;
                                    break;
                                case 'inside':
                                default:
                                    newParentId = targetNodeId;
                                    index = lastDescendantIndex > -1 ? lastDescendantIndex + 1 : 0;
                                    break;
                            }

                            await this._convertWindowToGroup(dragData.draggedNodeId, newParentId, targetWindowId, index);
                            break; // Finish here for this special case
                        }


                        const sourceIsClosed = draggedNode.type === 'window' ? this.get_window(draggedNode.wid).win.closed : this.get_tab(draggedNode.tid).tab.closed;
                        const targetIsClosed = targetNode.type === 'window' ? this.get_window(targetNode.wid).win.closed : this.get_tab(targetNode.tid).tab.closed;

                        // This is a pure UI re-ordering within a live window.
                        if (!sourceIsClosed && !targetIsClosed) {
                            const orderedTabs = this._getOrderedTabList(targetWindowId);
                            const lastDescendantId = this._getSubtree(targetNodeId).pop()!;
                            const lastDescendantNode = this.tree.get(lastDescendantId);
                            const lastDescendantIndex = lastDescendantNode && lastDescendantNode.type !== 'window' ? orderedTabs.indexOf(this.get_tab_node(lastDescendantId).tab.id) : -1;

                            const currentIndex = orderedTabs.indexOf(this.get_tab_node(dragData.draggedNodeId).tab.id);
                            const targetIndex = orderedTabs.indexOf(targetNodeId);

                            let newParentId: BruhId;
                            let index: number;

                            switch (action) {
                                case 'above':
                                    newParentId = (targetNode as Extract<Node, { type: 'tab' | 'group' }>).parentId;
                                    index = currentIndex > targetIndex ? targetIndex : targetIndex - 1;
                                    break;
                                case 'below':
                                    newParentId = (targetNode as Extract<Node, { type: 'tab' | 'group' }>).parentId;
                                    index = currentIndex > lastDescendantIndex ? lastDescendantIndex + 1 : lastDescendantIndex;
                                    break;
                                case 'root':
                                    newParentId = targetNodeId;
                                    index = this.get_window(targetWindowId).win.tabIds.length;
                                    break;
                                case 'inside':
                                default:
                                    newParentId = targetNodeId;
                                    index = lastDescendantIndex > -1 ? (currentIndex > lastDescendantIndex ? lastDescendantIndex + 1 : lastDescendantIndex) : 0;
                                    break;
                            }

                            // Reparent only the root of the dragged subtree in our state
                            this._setParent(dragData.draggedNodeId, newParentId);

                            // Collect all browser tab IDs from the dragged subtree
                            const tidsToMove = dragData.movedNodeIds.map(id => this.get_tab_node(id).tab.tid);

                            // Perform a single, block move operation in the browser UI
                            await browser.tabs.move(tidsToMove, { windowId: targetWindowId, index });

                        } else { // All other cases involve state changes (Live->Dead, Dead->Live, Dead->Dead)
                            let newParentId: BruhId;
                            let index = -1; // Index is only relevant for Dead->Live moves

                            switch (action) {
                                case 'above':
                                case 'below':
                                    newParentId = (targetNode as Extract<Node, { type: 'tab' | 'group' }>).parentId;
                                    break;
                                case 'root':
                                case 'inside':
                                default:
                                    newParentId = targetNodeId;
                                    break;
                            }

                            // For Dead->Live, we need to calculate a browser insert index
                            if (sourceIsClosed && !targetIsClosed) {
                                const orderedTabs = this._getOrderedTabList(targetWindowId);
                                const lastDescendantId = this._getSubtree(targetNodeId).pop()!;
                                const lastDescendantNode = this.tree.get(lastDescendantId);
                                const lastDescendantIndex = lastDescendantNode && lastDescendantNode.type !== 'window' ? orderedTabs.indexOf(this.get_tab_node(lastDescendantId).tab.id) : -1;

                                if (action === 'above') {
                                    index = orderedTabs.indexOf(targetNodeId);
                                } else {
                                    index = lastDescendantIndex > -1 ? lastDescendantIndex + 1 : 0;
                                }
                            }

                            // The universal _moveNode handles the complex state transitions
                            await this._moveNode(dragData.draggedNodeId, newParentId, index);
                        }
                    } break; case 'FOCUS_TAB': {
                        const { tid } = this.get_tab_node(message.payload.nodeId).tab;
                        await browser.tabs.update(tid, { active: true });
                    } break;
                    case 'CLOSE_SUBTREE': {
                        const tids = this._getSubtree(message.payload.nodeId)
                            .map(id => this.get_node(id).node)
                            .filter(n => n.type !== 'window')
                            .map(n => (n as Extract<Node, { type: 'tab' | 'group' }>).tid);
                        if (tids.length > 0) await browser.tabs.remove(tids);
                    } break;
                    case 'CLOSE_SINGLE_TAB': {
                        const tid = this.get_tab_node(message.payload.nodeId).tab.tid;
                        await browser.tabs.remove(tid);
                    } break;
                    case 'DUPLICATE_TAB_SMART': {
                        const { tab: originalTab, node: originalNode } = this.get_tab_node(message.payload.nodeId);
                        const newTab = await browser.tabs.create({
                            windowId: originalTab.wid,
                            url: originalTab.url,
                            active: false,
                            discarded: true,
                            title: this.get_node_name(originalTab.id),
                            index: message.payload.tabIndex,
                        });
                        const { tab: newBruhTab } = await this._createTabNode(newTab);
                        this._setParent(newBruhTab.id, originalNode.parentId);
                    } break;
                    case 'UNLOAD_TAB': {
                        const tid = this.get_tab_node(message.payload.nodeId).tab.tid;
                        await browser.tabs.discard(tid);
                    } break;
                    case 'UNLOAD_TREE': {
                        const tids = this._getSubtree(message.payload.nodeId).map(id => this.get_tab_node(id).tab.tid);
                        await browser.tabs.discard(tids);
                    } break;
                    case 'LOAD_TREE': {
                        const tids = this._getSubtree(message.payload.nodeId).map(id => this.get_tab_node(id).tab.tid);
                        for (const tid of tids) await browser.tabs.reload(tid);
                    } break;
                    case 'MOVE_SUBTREE_TO_NEW_WINDOW': {
                        await this._moveSubtreeToNewWindow(message.payload.rootNodeId);
                    } break;
                    case 'CREATE_TAB': {
                        const newTab = await browser.tabs.create({ windowId: message.payload.windowId, active: false });
                        const { tab } = await this._createTabNode(newTab);
                        // TODO: set tab's parent properly
                        // this._setParent(tab.id, message.payload.parentId);

                        const win = this.get_window(newTab.windowId! as WindowId);
                        win.win.tabIds.splice(tab.index, 0, newTab.id as TabId);
                    } break;
                    case 'CREATE_TAB_FROM_URL': {
                        const { url, windowId, parentId } = message.payload;
                        const newTab = await browser.tabs.create({ windowId, url, active: false, discarded: true, });
                        const { tab } = await this._createTabNode(newTab);
                        // TODO: set tab's parent properly
                        // this._setParent(tab.id, parentId);

                        const win = this.get_window(newTab.windowId! as WindowId);
                        win.win.tabIds.splice(tab.index, 0, newTab.id as TabId);
                    } break;
                    case 'RENAME_WINDOW': {
                        const { windowId, newName } = message.payload;
                        const win = this.get_window(windowId);
                        const attrs = this.groupAttrs.get(win.win.id)!;
                        attrs.name = newName;
                        attrs.isCustomNamed = true;
                    } break;
                    case 'CLOSE_WINDOW': {
                        await browser.windows.remove(message.payload.windowId);
                    } break;
                    case 'RESTORE_WINDOW': {
                        const { win } = this.get_window(message.payload.windowId);
                        await this._restoreUI(win.id);
                    } break;
                    case 'DELETE_WINDOW_STATE': {
                        const { win } = this.get_window(message.payload.windowId);
                        if (win.closed) {
                            const subtree = this._getSubtree(win.id);
                            for (const id of subtree) {
                                this.remove_node(id);
                                this.browserRestoreCache.delete(id);
                            }
                        } else {
                            await browser.windows.remove(win.wid);
                        }
                    } break;
                    case 'FLATTEN_IMMEDIATE': {
                        await this._flattenNode(message.payload.nodeId, false);
                    } break;
                    case 'FLATTEN_TREE': {
                        await this._flattenNode(message.payload.nodeId, true);
                    } break;
                    case 'CREATE_GROUP': {
                        const { windowId, parentId } = message.payload;
                        const bid = this.bruhid++ as BruhId;
                        this.groupAttrs.set(bid, { name: this._generateUniqueGroupName(), isCustomNamed: false, generation: bid });
                        const groupTab = await browser.tabs.create({
                            windowId,
                            active: false,
                            discarded: true,
                            title: "Tabruh Group",
                            url: this._getGroupUrl(bid),
                        });
                        const { tab } = await this._createTabNode(groupTab, { id: bid });
                        this._setParent(tab.id, parentId);

                        const orderedTabs = this._getOrderedTabList(windowId);
                        const lastDescendantId = this._getSubtree(parentId).pop()!;
                        const lastDindex = orderedTabs.indexOf(lastDescendantId);
                        this._addTabToWindow(tab.tid, tab.wid, lastDindex == -1 ? orderedTabs.length : (lastDindex + 1));
                    } break;
                    case 'RENAME_NODE': {
                        const { nodeId, newName } = message.payload;
                        const { node, tab } = this.get_tab_node(nodeId);
                        const attrs = this.groupAttrs.get(nodeId)!;
                        attrs.name = newName;
                        attrs.isCustomNamed = true;
                        tab.title = newName;
                        if (node.type === 'group') {
                            const newUrl = this._getGroupUrl(nodeId);
                            await browser.tabs.update(tab.tid, { url: newUrl });
                        }
                    } break;
                    default:
                        throw utils.exhausted(message);
                }
            } break;
            default:
                throw utils.exhausted(event);
        }
        await this._saveState();
    }
};

async function main() {
    let app = await App.init();
    await app.attach_listeners();
    let _ = app.process_events();

    // @ts-ignore
    globalThis.app = app;

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
