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
    // TODO:
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
    groupAttrs: Map<BruhId, GroupAttrs> = new Map();

    closing_window_tabs: Map<WindowId, Set<TabId>> = new Map();
    restoring_tab_ids: Set<TabId> = new Set();
    restoring_window_ids: Set<WindowId> = new Set();

    private session_tab_key = "tabruh-tab-state";
    private session_window_key = "tabruh-window-state";
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
            this.session_tab_key += Math.random().toString();
            this.session_window_key += Math.random().toString();
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
        } else {
            throw new Error("cannot remove root node");
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

        return {
            id: rootNode.node.id,
            windowId: win.win.wid,
            name: attrs.name,
            isCustomNamed: attrs.isCustomNamed,
            isClosed: win.win.closed,
            generation: attrs.generation,
            tree: uiTree,
            tabsById: new Map(this.tabs.entries()),
            rootIds,
        };
    }

    async _process_event(event: StateManagerEvent) {
        switch (event.type) {
            case 'tabCreated': { } break;
            case 'tabRemoved': { } break;
            case 'tabUpdated': { } break;
            case 'tabMoved': { } break;
            case 'tabAttached': { } break;
            case 'tabDetached': { } break;
            case 'tabActivated': { } break;
            case 'windowCreated': { } break;
            case 'windowRemoved': { } break;
            case 'windowFocusChanged': { } break;
            case 'portMessage': {
                const message = event.payload.message;
                switch (message.type) {
                    case 'GET_STATE_FOR_WINDOW': { } break;
                    case 'GET_STATE_FOR_GROUP_VIEW': { } break;
                    case 'GET_ALL_WINDOW_STATES': { } break;
                    case 'TOGGLE_COLLAPSE': { } break;
                    case 'HANDLE_DROP': { } break;
                    case 'CLOSE_SUBTREE': { } break;
                    case 'CLOSE_SINGLE_TAB': { } break;
                    case 'DUPLICATE_TAB_SMART': { } break;
                    case 'UNLOAD_TAB': { } break;
                    case 'UNLOAD_TREE': { } break;
                    case 'LOAD_TREE': { } break;
                    case 'MOVE_SUBTREE_TO_NEW_WINDOW': { } break;
                    case 'CREATE_TAB': { } break;
                    case 'CREATE_TAB_FROM_URL': { } break;
                    case 'RENAME_WINDOW': { } break;
                    case 'CLOSE_WINDOW': { } break;
                    case 'RESTORE_WINDOW': { } break;
                    case 'DELETE_WINDOW_STATE': { } break;
                    case 'FLATTEN_IMMEDIATE': { } break;
                    case 'FLATTEN_TREE': { } break;
                    case 'CREATE_GROUP': { } break;
                    case 'RENAME_NODE': { } break;
                    case 'FOCUS_TAB': { } break;
                    default:
                        throw utils.exhausted(message);
                }
            } break;
            default:
                throw utils.exhausted(event);
        }
    }
};

class OldApp {
    private async _saveAppState(): Promise<void> {
        this._appStateDirty = false;
        await browser.storage.local.set({
            [this.storage_key]: {
                bruhid: this.bruhid,
                hgid: this.hierarchy_generation_id,
            }
        });
    }

    private async _loadAppState(): Promise<void> {
        const data = await browser.storage.local.get(this.storage_key);
        if (data && data[this.storage_key]) {
            this.bruhid = data[this.storage_key].bruhid || 1;
            this.hierarchy_generation_id = data[this.storage_key].hgid || 1;
        }
    }

    private _incrementHgid() {
        this.hierarchy_generation_id++;
        this._appStateDirty = true;
        return this.hierarchy_generation_id;
    }

    private async _saveNodeState(nodeId: BruhId): Promise<void> {
        const node = this.tree.get(nodeId)!;

        if (node.type === 'window') {
            await this._saveWindowState(node.wid);
        } else {
            const data: BruhTabSessionData = {
                bruhId: node.id,
                parentId: node.parentId,
                ancestorIds: this._getAncestors(node.id),
                childrenIds: this._getChildrenMap().get(node.id) || [],
                hgid: node.hierarchy_generation_id,
                collapsed: node.collapsed,
                type: node.type,
                groupAttrs: node.type === 'group' ? this.groupAttrs.get(node.id) : undefined,
            };
            await browser.sessions.setTabValue(node.tid, this.session_tab_key, data);
        }
    }

    private async _saveWindowState(windowId: WindowId): Promise<void> {
        const win = this.get_window(windowId);
        const data: BruhWindowSessionData = {
            bruhId: win.id,
            hgid: win.hierarchy_generation_id,
            groupAttrs: this.groupAttrs.get(win.id)!,
        };
        await browser.sessions.setWindowValue(windowId, this.session_window_key, data);
    }

    private async _readTabState(tabId: TabId): Promise<BruhTabSessionData | undefined> {
        try {
            const data = await browser.sessions.getTabValue(tabId, this.session_tab_key);
            if (data) {
                return data as BruhTabSessionData;
            }
            return undefined;
        } catch (e) {
            return undefined;
        }
    }

    private async _readWindowState(windowId: WindowId): Promise<BruhWindowSessionData | undefined> {
        try {
            const data = await browser.sessions.getWindowValue(windowId, this.session_window_key);
            if (data) {
                return data as BruhWindowSessionData;
            }
            return undefined;
        } catch (e) {
            return undefined;
        }
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

    save_tab(
        tab: browser.Tabs.Tab,
        parent: "window" | "opener",
        options: { id?: BruhId, forceIsGroup?: boolean, updateComplete?: boolean, sessionData?: BruhTabSessionData } = {},
    ): BruhTab & Extract<Node, { type: "group" | "tab" }> {
        if (tab.id === undefined || tab.windowId === undefined) throw Error(`tab does not have an id or windowId? ${tab.title}`);
        const old = this.tabs.get(tab.id);
        if (old) {
            old.wid = tab.windowId;
            old.index = tab.index;
            old.active = tab.active;
            old.discarded = tab.discarded ?? false;
            const node = this.tree.get(old.id) as Extract<Node, { type: "tab" | "group" }>;
            node.title = tab.title ?? node.title;
            node.favIconUrl = tab.favIconUrl ?? node.favIconUrl;
            node.url = tab.url ?? "";

            const wasGroup = node.type === 'group';
            const isGroup = this._isGroupTab(tab);

            if (isGroup && !wasGroup) {
                // @ts-ignore // not sure why it is yelling here.
                node.type = 'group';
                const parsedAttrs = this._parseGroupUrlAttrs(tab.url!)?.attrs;
                if (parsedAttrs) {
                    const attrs = this.getOrGenerateGroupAttrs(node.id);
                    Object.assign(attrs, parsedAttrs);
                    node.title = attrs.name;
                } else {
                    node.title = this.getOrGenerateGroupAttrs(node.id).name;
                }
            } else if (!isGroup && wasGroup) {
                // @ts-ignore // not sure why it is yelling here.
                node.type = 'tab';
            }

            if (isGroup && options.updateComplete) {
                const expectedUrl = this._getGroupUrl(node.id);
                const urlAttrs = this._parseGroupUrlAttrs(tab.url!);
                if (urlAttrs?.id !== node.id) {
                    browser.tabs.update(node.tid, { url: expectedUrl });
                    node.url = expectedUrl;
                }
            }

            return this.get_tab(old.tid);
        } else {
            const sessionData = options.sessionData;
            let id: BruhId;
            if (options.id !== undefined) {
                id = options.id;
            } else {
                id = this.bruhid++;
                this._appStateDirty = true;
            }

            const new_tab = {
                id: id,
                tid: tab.id,
                wid: tab.windowId,
                index: tab.index,
                discarded: tab.discarded ?? false,
                active: tab.active,
                closed: false,
            };
            this.tabs.set(tab.id, new_tab);

            const isGroup = sessionData ? sessionData.type === 'group' : (options.forceIsGroup || this._isGroupTab(tab));

            let title: string;
            if (isGroup) {
                const groupAttrs = sessionData?.groupAttrs || this._parseGroupUrlAttrs(tab.url!)?.attrs;
                if (groupAttrs) {
                    this.groupAttrs.set(new_tab.id, { ...groupAttrs });
                    title = groupAttrs.name;
                } else {
                    title = this.getOrGenerateGroupAttrs(new_tab.id).name;
                }
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
                collapsed: sessionData?.collapsed || false,
                hierarchy_generation_id: sessionData ? sessionData.hgid : 1,
            } as Node & { type: "group" | "tab" };
            this.tree.set(new_tab.id, node);

            if (isGroup && options.updateComplete) {
                const correctUrl = this._getGroupUrl(new_tab.id);
                if (node.url !== correctUrl) {
                    browser.tabs.update(new_tab.tid, { url: correctUrl });
                    node.url = correctUrl;
                }
            }

            return this.get_tab(new_tab.tid);
        }
    }

    save_window(win: browser.Windows.Window, options: { id?: BruhId, hgid?: number, sessionData?: BruhWindowSessionData } = {}): Readonly<BruhWindow & Node> {
        if (win.id === undefined) throw Error(`window does not have id :/`);
        const old = this.windows.get(win.id);
        if (old) {
            return this.get_window(old.wid);
        } else {
            const sessionData = options.sessionData;
            let id: BruhId;
            if (options.id !== undefined) {
                id = options.id;
            } else {
                id = this.bruhid++;
                this._appStateDirty = true;
            }

            const new_window = {
                id: id,
                wid: win.id,
                tabIds: [],
                closed: false,
            };
            this.windows.set(win.id, new_window);

            const groupAttrs = sessionData?.groupAttrs || this.getOrGenerateGroupAttrs(new_window.id);
            this.groupAttrs.set(new_window.id, groupAttrs);

            const new_node = {
                id: new_window.id,
                title: groupAttrs.name,
                type: "window",
                wid: win.id,
                hierarchy_generation_id: sessionData?.hgid || options.hgid || 1,
            } as Node;
            this.tree.set(new_window.id, new_node);

            return this.get_window(new_window.wid);
        }
    }

    async init_tree() {
        const oldIdToNewIdMap = new Map<BruhId, BruhId>();
        const tabSessionDataMap = new Map<TabId, BruhTabSessionData>();
        const windowSessionDataMap = new Map<WindowId, BruhWindowSessionData>();

        let windows = await browser.windows.getAll({ windowTypes: ["normal"], populate: true });

        // Pass 1: Discover all restored entities, assign new BruhIds, and build the mapping.
        for (const w of windows) {
            if (!w.id) continue;
            const sessionData = await this._readWindowState(w.id);
            if (sessionData) {
                const newId = this.bruhid++;
                oldIdToNewIdMap.set(sessionData.bruhId, newId);
                windowSessionDataMap.set(w.id, sessionData);
            }
        }
        for (const w of windows) {
            for (const t of w.tabs ?? []) {
                if (!t.id) continue;
                const sessionData = await this._readTabState(t.id);
                if (sessionData) {
                    const newId = this.bruhid++;
                    oldIdToNewIdMap.set(sessionData.bruhId, newId);
                    tabSessionDataMap.set(t.id, sessionData);
                }
            }
        }
        if (oldIdToNewIdMap.size > 0) {
            this._appStateDirty = true;
        }

        // Pass 2: Create all windows and tabs in our state using the pre-assigned new IDs.
        for (const w of windows) {
            if (!w.id) continue;
            const sessionData = windowSessionDataMap.get(w.id);
            const newId = sessionData ? oldIdToNewIdMap.get(sessionData.bruhId) : undefined;
            this.save_window(w, { id: newId, sessionData: sessionData });
            (this.windows.get(w.id)!).tabIds = w.tabs?.map(t => t.id!).filter(t => t !== undefined) as TabId[] ?? [];
        }
        for (const w of windows) {
            for (const t of w.tabs ?? []) {
                if (!t.id) continue;
                const sessionData = tabSessionDataMap.get(t.id);
                const newId = sessionData ? oldIdToNewIdMap.get(sessionData.bruhId) : undefined;
                this.save_tab(t, "window", { id: newId, sessionData: sessionData });
            }
        }

        // Pass 3: Link parents for restored tabs and handle openerTabId as fallback.
        for (const w of windows) {
            for (const t of w.tabs ?? []) {
                if (!t.id) continue;
                const bruhTab = this.tabs.get(t.id);
                if (!bruhTab) continue;

                const sessionData = tabSessionDataMap.get(t.id);
                let parentSet = false;
                if (sessionData) {
                    const oldParentId = sessionData.parentId;
                    const newParentId = oldIdToNewIdMap.get(oldParentId)!;
                    this.set_parent(bruhTab.id, newParentId, false);
                    parentSet = true;
                }

                if (!parentSet) {
                    if (t.openerTabId && this.tabs.has(t.openerTabId)) {
                        const opener = this.get_tab(t.openerTabId);
                        this.set_parent(bruhTab.id, opener.id, false);
                    }
                }
            }
        }

        // Pass 4: Save state for all nodes
        for (const [wid, _] of this.windows) {
            await this._saveWindowState(wid);
        }
        for (const [tid, _] of this.tabs) {
            const bruhTab = this.tabs.get(tid)!;
            await this._saveNodeState(bruhTab.id);
        }

        if (this._appStateDirty) {
            await this._saveAppState();
        }
    }

    async _process_event(event: StateManagerEvent) {
        if (this.config.dbg.log_events) {
            if (event.type == "portMessage") {
                // console.log(Date.now(), event.type, event.payload.message.type, event.payload.message.payload);
            } else {
                console.log(Date.now(), event.type, event.payload);
            }
        }

        const nodesToSave = new Set<BruhId>();

        switch (event.type) {
            case 'tabCreated': {
                const t = event.payload;

                if (this.restoring_tab_ids.has(t.id!)) {
                    this.restoring_tab_ids.delete(t.id!);
                    return;
                }
                let win = this.windows.get(t.windowId!);
                if (!win) {
                    const sessionData = await this._readWindowState(t.windowId!);
                    this.save_window({ id: t.windowId } as browser.Windows.Window, { sessionData });
                    win = this.windows.get(t.windowId!)!;
                    nodesToSave.add(win.id);

                    if (sessionData) this.remove_node(sessionData.bruhId);
                }

                const sessionData = await this._readTabState(t.id!);
                // TODO: refactor save_tab/save_window in 2. one for save, another for update.
                const newTab = this.save_tab(t, "opener", { sessionData });
                nodesToSave.add(newTab.id);
                nodesToSave.add(newTab.parentId);

                if (sessionData) this.remove_node(sessionData.bruhId);

                // TODO: sessiondata's ids are stale here
                if (sessionData) {
                    let parentIdToSet = win.id;
                    if (this.tree.has(sessionData.parentId)) {
                        parentIdToSet = sessionData.parentId;
                    } else {
                        for (const ancestorId of sessionData.ancestorIds) {
                            if (this.tree.has(ancestorId)) {
                                parentIdToSet = ancestorId;
                                break;
                            }
                        }
                    }
                    this.set_parent(newTab.id, parentIdToSet, false);
                    nodesToSave.add(parentIdToSet);

                    for (let child of sessionData.childrenIds) {
                        if (!this.tree.has(child)) continue;
                        const ctab = this.tree.get(child)! as Node & { type: "tab" | "group" };
                        console.log(ctab.hierarchy_generation_id, sessionData.hgid)
                        if (ctab.parentId === parentIdToSet && ctab.hierarchy_generation_id <= sessionData.hgid) {
                            this.set_parent(ctab.id, newTab.id, false);
                            nodesToSave.add(ctab.id);
                        }
                    }
                }

                win.tabIds.splice(t.index, 0, t.id!);
                for (let i = t.index + 1; i < win.tabIds.length; i++) {
                    (this.tabs.get(win.tabIds[i]!)!).index = i;
                }
            } break;
            case 'tabRemoved': {
                const e = event.payload;
                const tabToRemove = this.get_tab(e.tabId);
                const oldParentId = tabToRemove.parentId;

                if (e.removeInfo.isWindowClosing) {
                    if (!this.closing_window_tabs.has(e.removeInfo.windowId)) {
                        this.closing_window_tabs.set(e.removeInfo.windowId, new Set());
                    }
                    this.closing_window_tabs.get(e.removeInfo.windowId)!.add(e.tabId);
                    this.set_tab_closed(e.tabId, true);
                } else {
                    // TODO: this is critical to tab restoration.
                    //  but this won't work here as the tab is gone.
                    //  we need to refactor this to store just the bid in tab's session data on tab creation.
                    //  rest of the data must be stored in the local storage :/
                    //  now we also need to manage the cache carefully and have no leaks :(
                    // this.tree.get(tabToRemove.id)!.hierarchy_generation_id = this._incrementHgid();
                    // await this._saveNodeState(tabToRemove.id);

                    const win = this.windows.get(tabToRemove.wid)!;
                    const oldIndex = win.tabIds.indexOf(e.tabId);
                    if (oldIndex < 0) throw Error(`tab tid: ${e.tabId} not found in window wid: ${win.wid}`);
                    win.tabIds.splice(oldIndex, 1);
                    for (let i = oldIndex; i < win.tabIds.length; i++) {
                        (this.tabs.get(win.tabIds[i]!)!).index = i;
                    }
                    const children = this._getChildrenMap().get(tabToRemove.id) || [];
                    for (const childId of children) {
                        this.set_parent(childId, tabToRemove.parentId, false);
                        nodesToSave.add(childId);
                    }
                    this.remove_tab(e.tabId);
                    nodesToSave.add(oldParentId);
                }
            } break;
            case 'tabUpdated': {
                const t = event.payload.tab;
                const bruhTab = this.save_tab(t, "opener", { updateComplete: event.payload.changeInfo.status == "complete" });
                nodesToSave.add(bruhTab.id);
            } break;
            case 'tabMoved': {
                const { tabId, moveInfo } = event.payload;
                const win = this.windows.get(moveInfo.windowId)!;
                const [movedTabId] = win.tabIds.splice(moveInfo.fromIndex, 1);
                win.tabIds.splice(moveInfo.toIndex, 0, movedTabId!);
                for (let i = 0; i < win.tabIds.length; i++) {
                    (this.tabs.get(win.tabIds[i]!)!).index = i;
                }
            } break;
            case 'tabAttached': {
                const { tabId, attachInfo } = event.payload;
                const tab = this.tabs.get(tabId)!;
                const newWin = this.windows.get(attachInfo.newWindowId)!;

                tab.wid = attachInfo.newWindowId;
                newWin.tabIds.splice(attachInfo.newPosition, 0, tabId);
                for (let i = 0; i < newWin.tabIds.length; i++) {
                    (this.tabs.get(newWin.tabIds[i]!)!).index = i;
                }
                nodesToSave.add(newWin.id);
            } break;
            case 'tabDetached': {
                const { tabId, detachInfo } = event.payload;
                const oldWin = this.windows.get(detachInfo.oldWindowId)!;
                const oldIndex = oldWin.tabIds.indexOf(tabId);
                if (oldIndex > -1) {
                    oldWin.tabIds.splice(oldIndex, 1);
                    for (let i = oldIndex; i < oldWin.tabIds.length; i++) {
                        (this.tabs.get(oldWin.tabIds[i]!)!).index = i;
                    }
                }
                nodesToSave.add(oldWin.id);
            } break;
            case 'tabActivated': {
                const e = event.payload;
                const win = this.windows.get(e.windowId)!;
                for (const tid of win.tabIds) {
                    (this.tabs.get(tid)!).active = (tid === e.tabId);
                }
            } break;
            case 'windowCreated': {
                const win = event.payload;
                if (!win.id) return;
                if (this.restoring_window_ids.has(win.id)) {
                    this.restoring_window_ids.delete(win.id);
                    return;
                }
                // If window already exists (created on-the-fly by tabCreated), this will just update it.
                const sessionData = await this._readWindowState(win.id);
                const bruhWin = this.save_window(win, { sessionData });
                nodesToSave.add(bruhWin.id);
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
                        if (!this.tree.has(message.payload.nodeId)) {
                            // tab urls have node ids, so dead group state can be requested if it's url is loaded after it is dead
                            return;
                        }
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
                        if (node.type === 'window') throw Error(`node bid: ${node.id} cannot be collapsed`);
                        this.set_collapsed(node.id, !node.collapsed);
                        nodesToSave.add(node.id);
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

                        nodesToSave.add(newParentId);
                        if (targetNode.type !== 'window') {
                            nodesToSave.add(targetNode.parentId);
                        }


                        if (draggedNode.type == "window") {
                            const oldAttrs = this.groupAttrs.get(draggedNode.id)!;
                            const newNodeId = this.bruhid++;
                            this._appStateDirty = true;
                            this.groupAttrs.set(newNodeId, { ...oldAttrs });
                            const url = this._getGroupUrl(newNodeId);

                            const groupTab = await browser.tabs.create({
                                windowId: targetWindowId,
                                index,
                                url,
                                active: false,
                                discarded: true,
                                title: oldAttrs.name,
                            });
                            const groupNode = this.save_tab(groupTab, "window", { id: newNodeId, forceIsGroup: true });
                            this.set_parent(groupNode.id, newParentId, true);
                            newParentId = groupNode.id;
                            index += 1;
                        }

                        const tidsToMove: TabId[] = [];
                        for (const nodeId of dragData.movedNodeIds) {
                            const node = this.get_node(nodeId);
                            if (node.type === 'tab' || node.type === 'group') {
                                if (draggedNode.type == "window") {
                                    if (node.parentId == draggedNode.id) this.set_parent(node.id, newParentId, true);
                                } else if (node.id === draggedNode.id) {
                                    this.set_parent(node.id, newParentId, true);
                                }
                                tidsToMove.push(node.tid);
                                nodesToSave.add(nodeId);
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
                            this.set_parent(childId, node.parentId, false);
                            nodesToSave.add(childId);
                        }
                        nodesToSave.add(node.parentId);
                        await browser.tabs.remove(node.tid);
                    } break;
                    case 'DUPLICATE_TAB_SMART': {
                        // TODO: maybe use browser.tabs.duplicate
                        //  that api can duplicate tabs that the extension cannot otherwise create (about:processes)
                        const node = this.get_node(message.payload.nodeId);
                        if (node.type === 'window') return;
                        const isDuplicatingGroup = node.type === 'group';
                        let url = node.url;
                        let new_id: BruhId | undefined = undefined;

                        if (isDuplicatingGroup) {
                            new_id = this.bruhid++;
                            this._appStateDirty = true;
                            this.getOrGenerateGroupAttrs(new_id); // Create new attrs for the new group
                            url = this._getGroupUrl(new_id);
                        }
                        const newTab = await browser.tabs.create({
                            windowId: node.wid,
                            url: url,
                            active: false,
                            index: message.payload.tabIndex,
                        });
                        const newNode = this.save_tab(newTab, "window", { id: new_id, forceIsGroup: isDuplicatingGroup });
                        this.set_parent(newNode.id, node.parentId, false);
                        nodesToSave.add(newNode.id);
                        nodesToSave.add(node.parentId);
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
                        nodesToSave.add(win.id);
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
                                if (child.parentId === node.id) {
                                    this.set_parent(child.id, win.id, true);
                                    nodesToSave.add(child.id);
                                }
                            }
                            await browser.tabs.remove(node.tid);
                        } else if (node.type === "tab") {
                            this.set_parent(node.id, win.id, true);
                            nodesToSave.add(node.id);
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
                        this.set_parent(node.id, parentId, false);
                        // nodesToSave.add(node.id);
                        // nodesToSave.add(parentId);
                    } break;
                    case 'CREATE_TAB_FROM_URL': {
                        const { url, windowId, parentId } = message.payload;
                        const orderedTabs = this._getOrderedTabList(windowId);
                        const lastDescendantId = this._getSubtree(parentId).pop()!;
                        const lastDescendantIndex = orderedTabs.indexOf(lastDescendantId);
                        const index = lastDescendantIndex >= 0 ? lastDescendantIndex + 1 : undefined;
                        const newTab = await browser.tabs.create({ windowId, url, index, active: false });
                        const node = this.save_tab(newTab, "window");
                        this.set_parent(node.id, parentId, false);
                        // nodesToSave.add(node.id);
                        // nodesToSave.add(parentId);
                    } break;
                    case 'RENAME_WINDOW': {
                        const { windowId, newName } = message.payload;
                        const win = this.get_window(windowId);
                        const attrs = this.groupAttrs.get(win.id)!;
                        this.set_title(win.id, newName);
                        attrs.name = newName;
                        attrs.isCustomNamed = true;
                        nodesToSave.add(win.id);
                    } break;
                    case 'CLOSE_WINDOW': {
                        await browser.windows.remove(message.payload.windowId);
                    } break;
                    case 'RESTORE_WINDOW': {
                        const wid = message.payload.windowId;

                        let old_to_new = new Map<BruhId, BruhId>();
                        const win = this.get_window(wid);
                        const tabsToRestore = win.tabIds.map(tid => this.get_tab(tid));
                        const win_attrs = this.groupAttrs.get(win.id)!;

                        const new_bwin = await browser.windows.create({});
                        this.restoring_window_ids.add(new_bwin.id!);
                        const extra_tab = new_bwin.tabs![0]!;
                        const new_win = this.save_window(new_bwin);
                        nodesToSave.add(new_win.id);

                        // Transfer attributes to the new window state
                        this.groupAttrs.set(new_win.id, { ...win_attrs });
                        old_to_new.set(win.id, new_win.id);
                        this.set_title(new_win.id, win_attrs.name);

                        // It is totally possible to have parent elements after children in tab.tabs
                        // so we pre-generate ids
                        if (tabsToRestore.length > 0) {
                            this._appStateDirty = true;
                        }
                        for (const tab of tabsToRestore) {
                            const new_id = this.bruhid++;
                            old_to_new.set(tab.id, new_id);
                        }

                        for (const tab of tabsToRestore) {
                            const attrs = this.groupAttrs.get(tab.id);
                            const new_id = old_to_new.get(tab.id)!;

                            let url = tab.url;
                            if (tab.type == "group") {
                                if (attrs) {
                                    this.groupAttrs.set(new_id, { ...attrs });
                                }
                                url = this._getGroupUrl(new_id);
                            }
                            if (this._isUrlFunny(url)) {
                                url = browser.runtime.getURL(`funny.html?url=${encodeURIComponent(url)}`)
                            }
                            const new_btab = await browser.tabs.create({
                                windowId: new_win.wid,
                                url: url,
                                index: tab.index,
                                active: false,
                                discarded: true,
                                title: tab.title,
                            });
                            this.restoring_tab_ids.add(new_btab.id!);

                            const new_tab = this.save_tab(new_btab, "window", { id: new_id, forceIsGroup: tab.type == "group" });
                            (this.windows.get(new_win.wid)!).tabIds.splice(new_tab.index, 0, new_tab.tid);

                            this.set_collapsed(new_tab.id, tab.collapsed);
                            this.set_parent(new_tab.id, old_to_new.get(tab.parentId)!, false);
                            (this.tree.get(new_tab.id)! as Node & { type: "tab" | "group" }).favIconUrl = tab.favIconUrl;
                            nodesToSave.add(new_tab.id);

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
                            this.set_parent(childId, node.parentId, true);
                            nodesToSave.add(childId);
                        }
                        nodesToSave.add(node.parentId);
                    } break;
                    case 'FLATTEN_TREE': {
                        const node = this.get_node(message.payload.nodeId);
                        if (node.type === 'window') return;
                        const descendants = this._getSubtree(node.id).filter(id => id !== node.id);
                        for (const descId of descendants) {
                            this.set_parent(descId, node.parentId, true);
                            nodesToSave.add(descId);
                        }
                        nodesToSave.add(node.parentId);
                    } break;
                    case 'CREATE_GROUP': {
                        const { windowId, parentId } = message.payload;
                        const newNodeId = this.bruhid++;
                        this._appStateDirty = true;
                        const attrs = this.getOrGenerateGroupAttrs(newNodeId);
                        const url = this._getGroupUrl(newNodeId);
                        const orderedTabs = this._getOrderedTabList(windowId);
                        const lastDescendantId = this._getSubtree(parentId).pop()!;
                        const lastDescendantIndex = orderedTabs.indexOf(lastDescendantId);
                        const index = lastDescendantIndex >= 0 ? lastDescendantIndex + 1 : undefined;
                        const groupTab = await browser.tabs.create({ windowId, index, url, active: false, discarded: true, title: attrs.name });
                        const newNode = this.save_tab(groupTab, "window", { id: newNodeId, forceIsGroup: true });
                        this.set_parent(newNode.id, parentId, false);
                        nodesToSave.add(newNode.id);
                        nodesToSave.add(parentId);
                    } break;
                    case 'RENAME_NODE': {
                        const { nodeId, newName } = message.payload;
                        const node = this.get_node(nodeId);
                        const attrs = this.groupAttrs.get(nodeId)!;
                        this.set_title(node.id, newName);
                        attrs.name = newName;
                        attrs.isCustomNamed = true;
                        nodesToSave.add(nodeId);
                        if (node.type === 'group') {
                            const newUrl = this._getGroupUrl(node.id);
                            await browser.tabs.update(node.tid, { url: newUrl });
                        }
                    } break;
                    default:
                        throw utils.exhausted(message);
                }
            } break;
            default:
                throw utils.exhausted(event);
        }

        try {
            for (const nodeId of nodesToSave) {
                await this._saveNodeState(nodeId);
            }
        } catch (e) {
            console.error(e);
        }
    }
}

async function main() {
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
