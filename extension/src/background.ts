import browser from 'webextension-polyfill';
import type {
    BackgroundRequest,
    BackgroundResponse,
    DragData,
    Node,
    StateManagerEvent,
    TabId,
    HierarchyGenerationId,
    UiNode,
    UiStateForRender,
    WindowId,
    BruhId,
    NodeStorageData,
    GroupName,
    TabData,
    UrlTabData,
    GroupTabData,
    WindowData,
    DropAction,
    BrowserEffect,
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
    open_sidebar_on_new_windows: boolean,
};

class App {
    ports: Set<browser.Runtime.Port> = new Set();
    eventChannel: utils.Channel<StateManagerEvent> = new utils.Channel();

    config: Config;
    user_config: UserConfig;
    bruhid: BruhId = 1 as BruhId;
    hierarchy_generation_id: HierarchyGenerationId = 1 as HierarchyGenerationId;

    window_ids: Map<BruhId, WindowId> = new Map();
    tab_ids: Map<BruhId, TabId> = new Map();
    window_bids: Map<WindowId, BruhId> = new Map();
    tab_bids: Map<TabId, BruhId> = new Map();
    nodes: Map<BruhId, Node> = new Map();
    browserRestoreCache: Map<BruhId, NodeStorageData> = new Map();

    // win -> []tab
    closing_window_tabs: Map<BruhId, Set<BruhId>> = new Map();
    restoring_bids: Set<BruhId> = new Set();
    forget_bids: Set<BruhId> = new Set();
    // win -> _
    pre_allocated_bids_for_non_pristine_restore: Map<BruhId, {
        ids: Map<BruhId, BruhId>,
        left_to_restore: Set<BruhId>,
    }> = new Map();

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
                    type: 'port_message',
                    payload: { message: message as BackgroundRequest, port }
                });
            });
            port.onDisconnect.addListener(() => {
                this.ports.delete(port);
            });
        });
        browser.tabs.onCreated.addListener(async (tab) => {
            let _ = await this.eventChannel.send({ type: 'tab_created', payload: { tab: tab } });
        });
        browser.tabs.onRemoved.addListener(async (tid, remove_info) => {
            let _ = await this.eventChannel.send({ type: 'tab_removed', payload: { tid: tid as TabId, remove_info } });
        });
        browser.tabs.onUpdated.addListener(async (tid, change_info, tab) => {
            let _ = await this.eventChannel.send({ type: 'tab_updated', payload: { tid: tid as TabId, change_info, tab } });
        });
        browser.tabs.onMoved.addListener(async (tid, move_info) => {
            let _ = await this.eventChannel.send({ type: 'tab_moved', payload: { tid: tid as TabId, move_info } });
        });
        browser.tabs.onAttached.addListener(async (tid, attach_info) => {
            let _ = await this.eventChannel.send({ type: 'tab_attached', payload: { tid: tid as TabId, attach_info } });
        });
        browser.tabs.onDetached.addListener(async (tid, detach_info) => {
            let _ = await this.eventChannel.send({ type: 'tab_detached', payload: { tid: tid as TabId, detach_info } });
        });
        browser.tabs.onActivated.addListener(async (activated_info) => {
            let _ = await this.eventChannel.send({ type: 'tab_activated', payload: { activated_info } });
        });
        browser.windows.onCreated.addListener(async (win) => {
            let _ = await this.eventChannel.send({ type: 'window_created', payload: { win } });
        });
        browser.windows.onRemoved.addListener(async (wid) => {
            let _ = await this.eventChannel.send({ type: 'window_removed', payload: { wid: wid as WindowId } });
        });
        browser.windows.onFocusChanged.addListener(async (wid) => {
            let _ = await this.eventChannel.send({ type: 'window_focus_changed', payload: { wid: wid as WindowId } });
        });
        browser.sessions.onChanged.addListener(async () => {
            let _ = await this.eventChannel.send({ type: 'sessions_changed', payload: {} });
        });
    }

    _is_group_tab(tab: browser.Tabs.Tab): boolean {
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
    is_url_funny(url_str: string): boolean {
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

    get_new_url(): string {
        return browser.runtime.getURL('new.html');
    }

    get_group_url(id: BruhId): string {
        const params = new URLSearchParams();
        params.set('view', 'group');
        params.set('id', String(id));
        return `${browser.runtime.getURL('overview.html')}?${params.toString()}`;
    }

    parse_group_url_id(url: string): BruhId | null {
        try {
            const urlObj = new URL(url);
            if (urlObj.protocol === 'moz-extension:' &&
                urlObj.pathname.endsWith('/overview.html') &&
                urlObj.searchParams.get('view') === 'group') {

                const id = parseInt(urlObj.searchParams.get('id')!, 10);
                return id as BruhId;
            }
        } catch (e) { /* Invalid URL */ }
        return null;
    }

    generate_unique_group_name(): string {
        let name: string;
        const existingNames = new Set(Array.from(this.nodes.values()).filter(node => node.type !== "tab").map(node => node.name.name));

        do {
            const adj = this.adjectives[Math.floor(Math.random() * this.adjectives.length)];
            const noun = this.nouns[Math.floor(Math.random() * this.nouns.length)];
            name = `${adj} ${noun}`;
        } while (existingNames.has(name));

        return name;
    }

    _post(port: browser.Runtime.Port, message: BackgroundResponse) {
        try {
            port.postMessage(message);
        } catch (e) {
            this.ports.delete(port);
        }
    }

    _broadcast(message: BackgroundResponse) {
        for (const port of this.ports) {
            this._post(port, message);
        }
    }

    _log_event(event: StateManagerEvent) {
        switch (event.type) {
            case 'tab_created':
            case 'tab_removed':
            case 'tab_moved':
            case 'tab_attached':
            case 'tab_detached':
            case 'window_created':
            case 'window_removed':
                console.log(Date.now(), event.type, event.payload);
                break;
            case 'tab_updated':
            case 'tab_activated':
            case 'window_focus_changed':
            case 'sessions_changed':
                break;
            case 'port_message':
                const message = event.payload.message;
                switch (message.type) {
                    case 'get_state_for_window':
                    case 'get_state_for_group_view':
                    case 'get_all_window_states':
                        break;

                    case 'toggle_collapse':
                    case 'handle_drop':
                    case 'close_subtree':
                    case 'close_single_tab':
                    case 'duplicate_tab_smart':
                    case 'unload_tab':
                    case 'unload_tree':
                    case 'load_tree':
                    case 'move_subtree_to_new_window':
                    case 'create_tab':
                    case 'close_window':
                    case 'restore_window':
                    case 'delete_window_state':
                    case 'flatten_tree':
                    case 'create_group':
                    case 'rename_node':
                    case 'focus_tab':
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

    _broadcast_updates(event: StateManagerEvent) {
        switch (event.type) {
            case 'tab_created':
            case 'tab_removed':
            case 'tab_updated':
            case 'tab_moved':
            case 'tab_attached':
            case 'tab_detached':
            case 'tab_activated':
            case 'window_created':
            case 'window_removed':
                this._broadcast({ type: 'render_all', payload: {} });
                break;

            case 'sessions_changed':
            case 'window_focus_changed':
                break;

            case 'port_message':
                const message = event.payload.message;
                switch (message.type) {
                    case 'get_state_for_window':
                    case 'get_state_for_group_view':
                    case 'get_all_window_states':
                        break;

                    case 'toggle_collapse':
                    case 'handle_drop':
                    case 'close_subtree':
                    case 'close_single_tab':
                    case 'duplicate_tab_smart':
                    case 'unload_tab':
                    case 'unload_tree':
                    case 'load_tree':
                    case 'move_subtree_to_new_window':
                    case 'create_tab':
                    case 'close_window':
                    case 'restore_window':
                    case 'delete_window_state':
                    case 'flatten_tree':
                    case 'create_group':
                    case 'rename_node':
                    case 'focus_tab':
                        this._broadcast({ type: 'render_all', payload: {} });
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
                this._log_event(event);
            }
            await this._process_event(event).catch(console.error);
            this._broadcast_updates(event);
        }
    }

    get_tab(bid: BruhId): TabData {
        const node = this.nodes.get(bid);
        if (!node || node?.type === "window") throw new Error(`tab with bid: ${bid} does not exist`);
        return node as TabData;
    }

    get_window(bid: BruhId): WindowData {
        const node = this.nodes.get(bid);
        if (!node || node?.type !== "window") throw new Error(`window with bid: ${bid} does not exist`);
        return node as WindowData;
    }

    get_node(bid: BruhId) {
        const node = this.nodes.get(bid);
        if (!node) throw Error(`node with bid ${bid} does not exist`);
        return node;
    }

    remove_node(bid: BruhId) {
        const node = this.nodes.get(bid);
        if (!node) throw new Error(`node with bid: ${bid} does not exist`);
        this.nodes.delete(bid);
        const tid = this.tab_ids.get(bid);
        if (tid !== undefined) this.tab_bids.delete(tid);
        this.tab_ids.delete(bid);
        return { type: 'node_removed', payload: { node } } as Extract<BrowserEffect, { type: 'node_removed' }>;
    }

    get_node_name(bid: BruhId): string {
        const node = this.get_node(bid);
        if (node.type == "window" || node.type == "group") {
            return node.name.name;
        } else {
            return node.title;
        }
    }

    get_node_url(bid: BruhId): string {
        const node = this.get_node(bid);
        if (node.type == "tab") {
            return node.url;
        } else {
            return this.get_group_url(bid);
        }
    }

    is_node_closed(bid: BruhId): boolean {
        const node = this.get_node(bid);
        const win = this.get_window(node.wbid);
        return win.closed;
    }

    get_children_map(): Map<BruhId, BruhId[]> {
        const map = new Map<BruhId, BruhId[]>();
        for (const [_, node] of this.nodes) {
            if (!map.has(node.parent_bid)) {
                map.set(node.parent_bid, []);
            }
            map.get(node.parent_bid)!.push(node.bid);
        }
        return map;
    }

    get_subtree(rootId: BruhId): BruhId[] {
        const subtree: BruhId[] = [];
        const stack: BruhId[] = [rootId];
        const visited = new Set<BruhId>();

        const childrenMap = this.get_children_map();

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

    get_ordered_tab_list(wbid: BruhId): BruhId[] {
        return this.get_window(wbid).tab_bids;
    }

    get_ancestors(nodeId: BruhId): BruhId[] {
        const ancestors: BruhId[] = [];
        let current = this.get_node(nodeId);
        if (current.type === 'window') {
            return ancestors;
        }

        let parent = this.get_node(current.parent_bid);
        while (parent.type !== 'window') {
            ancestors.push(parent.bid);
            parent = this.nodes.get(parent.parent_bid)!;
        }
        // last ancestor is a window
        ancestors.push(parent.bid);
        return ancestors;
    }

    get_index(bid: BruhId) {
        const node = this.get_tab(bid);
        const win = this.get_window(node.wbid);
        const index = win.tab_bids.indexOf(node.bid);
        return index;
    }

    get_tabs_before(bid: BruhId): BruhId[] {
        const node = this.get_node(bid);
        if (node.type == "window") {
            return [];
        } else {
            const win = this.get_window(node.wbid);
            const index = win.tab_bids.indexOf(node.bid);
            return win.tab_bids.slice(0, index == -1 ? 0 : index);
        }
    }

    increment_hgid(): HierarchyGenerationId {
        return this.hierarchy_generation_id++ as HierarchyGenerationId;
    }

    build_ui_state_for_render(wbid: BruhId, root_bid?: BruhId): UiStateForRender {
        const win = this.get_window(wbid);

        const childrenMap = this.get_children_map();
        const root_bids: BruhId[] = [];
        const uiTree: Map<BruhId, UiNode> = new Map();

        const rootId = root_bid || wbid;
        let nodeIdsToIterate: BruhId[];
        if (root_bid) {
            nodeIdsToIterate = this.get_subtree(root_bid).slice(1);
        } else {
            nodeIdsToIterate = win.tab_bids;
        }

        for (const bruhId of nodeIdsToIterate) {
            const node = this.get_tab(bruhId);
            const win = this.get_window(node.wbid);

            uiTree.set(node.bid, {
                id: node.bid,
                tid: this.tab_ids.get(node.bid),
                tab_index: this.get_index(node.bid),
                title: this.get_node_name(node.bid),
                url: this.get_node_url(node.bid),
                favIconUrl: node.type == "tab" ? node.fav_icon_url : undefined,
                isGroup: node.type === 'group',
                isDiscarded: node.discarded,
                isActive: win.active === node.bid,
                isCollapsed: node.collapsed,
                children: childrenMap.get(node.bid) || [],
            });

            if (node.parent_bid === rootId) {
                root_bids.push(node.bid);
            }
        }

        const rootNode = this.get_node(rootId);
        if (rootNode.type == "tab") throw new Error(`root_bid ${rootId} expected to be 'window' or 'group'`);

        return {
            id: rootNode.bid,
            wbid: wbid,
            name: rootNode.name.name,
            is_custom_named: rootNode.name.is_custom,
            is_closed: win.closed,
            generation: rootNode.name.generation,
            tree: uiTree,
            root_bids,
        };
    }

    remove_tab_from_window(tbid: BruhId, wbid: BruhId) {
        const tab = this.get_tab(tbid);
        const win = this.get_window(wbid);
        const index = win.tab_bids.indexOf(tbid);
        if (index > -1) {
            win.tab_bids.splice(index, 1);
        }
        if (win.active == tbid) {
            // we don't really know which tab the browser will focus. so we just expect browser to notify us, else we don't care anyway
            win.active = undefined;
        }
    }

    add_tab_to_window(tbid: BruhId, wbid: BruhId, index: number): void {
        const tab = this.get_tab(tbid);
        const win = this.get_window(wbid);

        if (tab.wbid !== wbid) {
            this.remove_tab_from_window(tab.bid, tab.wbid);
            this.remove_tab_from_window(tab.bid, wbid);
        } else {
            const index = win.tab_bids.indexOf(tbid);
            if (index > -1) {
                win.tab_bids.splice(index, 1);
            }
            // win.active remains same
        }

        win.tab_bids.splice(index, 0, tbid);
    }

    get_node_storage_data(bid: BruhId): NodeStorageData {
        const node = this.get_node(bid);
        const childrenIds = this.get_children_map().get(bid) || [];
        const ancestorIds = this.get_ancestors(bid);

        const storageData = {
            bid,
            hgid: node.hgid,
            wbid: node.wbid,
            cache_hgid: this.increment_hgid(),
            collapsed: node.collapsed,
            parent_bid: node.parent_bid,
            comes_after_bids: this.get_tabs_before(bid),
            ancestor_bids: ancestorIds,
            children_bids: childrenIds,
            url: this.get_node_url(bid),
            title: this.get_node_name(bid),
            tab_bids: (node.type === 'window') ? node.tab_bids : undefined,
            group_name: (node.type === 'group' || node.type === 'window') ? node.name : undefined,
            type: node.type,
        } as NodeStorageData;

        return storageData;
    }

    archive_node(bid: BruhId): void {
        const snapshot = this.get_node_storage_data(bid);
        this.browserRestoreCache.set(bid, snapshot);

        const node = this.get_node(bid);
        if (node.type === 'window') {
            node.is_archived_pristine = true;
        }
    }

    remove_node_and_reparent_children(bid: BruhId) {
        const node = this.get_node(bid);

        const children = this.get_children_map().get(bid) || [];
        for (const childId of children) {
            this.get_node(childId).parent_bid = node.parent_bid;
        }
        return this.remove_node(node.bid);
    }

    get_target_index(bid: BruhId, target_bid: BruhId, position: DropAction) {
        const node = this.get_node(bid);
        const target = this.get_node(target_bid);
        const target_win = this.get_window(target.wbid);

        const lastDescendantId = this.get_subtree(target.bid).pop()!;
        const lastDescendantIndex = this.get_index(lastDescendantId);
        const targetIndex = this.get_index(target.bid);
        let currentIndex = target_win.tab_bids.indexOf(node.bid);
        currentIndex = currentIndex >= 0 ? currentIndex : Infinity;

        let newParentId: BruhId;
        let index: number;

        switch (position) {
            case 'above':
                newParentId = target.parent_bid;
                index = currentIndex > targetIndex ? targetIndex : targetIndex - 1;
                break;
            case 'below':
                newParentId = target.parent_bid;
                index = currentIndex > lastDescendantIndex ? lastDescendantIndex + 1 : lastDescendantIndex;
                break;
            case 'inside':
            default:
                newParentId = target.bid;
                index = currentIndex > lastDescendantIndex ? lastDescendantIndex + 1 : lastDescendantIndex;
                break;
        }

        return { wbid: target_win.bid, parent_bid: newParentId, index };
    }

    reparent_node(bid: BruhId, new_parent_bid: BruhId, index?: number) {
        const node = this.get_node(bid);
        node.parent_bid = new_parent_bid;

        const parent = this.get_node(new_parent_bid);
        if (index === undefined) {
            index = this.get_target_index(node.bid, parent.bid, "inside").index;
        }
        const tbids_to_move = this.get_subtree(node.bid);
        for (let i = 0; i < tbids_to_move.length; i++) {
            const tbid = tbids_to_move[i]!;
            this.add_tab_to_window(node.bid, parent.wbid, index + i);
        }

        return { type: 'tabs_moved', payload: { tbids: tbids_to_move, wbid: parent.wbid, index } } as Extract<BrowserEffect, { type: 'tabs_moved' }>;
    }

    flatten_node(bid: BruhId, recursive: boolean, hgid: HierarchyGenerationId) {
        const node = this.get_node(bid);
        const nodesToMove = recursive ? this.get_subtree(bid).slice(1) : (this.get_children_map().get(bid) || []);
        for (const childId of nodesToMove) {
            const child = this.get_node(childId);
            child.parent_bid = node.parent_bid;
            child.hgid = hgid;
        }
    }

    // private async _moveNode(bruhId: BruhId, newParentId: BruhId, index: number): Promise<void> {
    //     const { node: sourceNode } = this.get_node(bruhId);
    //     const { node: targetParentNode } = this.get_node(newParentId);

    //     const sourceIsClosed = this.is_node_closed(sourceNode.id);
    //     const targetIsClosed = this.is_node_closed(targetParentNode.id);

    //     const sourceRootWindowId = this.get_node_wid(sourceNode.id);
    //     const targetRootWindowId = this.get_node_wid(targetParentNode.id);

    //     // Case: Dead -> Dead
    //     if (sourceIsClosed && targetIsClosed) {
    //         this._setParent(bruhId, newParentId);
    //         if (sourceRootWindowId) this.get_window(sourceRootWindowId).win.isArchivedPristine = false;
    //         if (targetRootWindowId) this.get_window(targetRootWindowId).win.isArchivedPristine = false;
    //     }
    //     // Case: Live -> Dead
    //     else if (!sourceIsClosed && targetIsClosed) {
    //         const subtreeIds = this._getSubtree(bruhId);
    //         const tidsToRemove = subtreeIds.map(id => this.get_tab_node(id).tab.tid);
    //         this._setParent(bruhId, newParentId);
    //         for (const id of subtreeIds) {
    //             this._archiveNode(id);
    //         }
    //         if (targetRootWindowId) this.get_window(targetRootWindowId).win.isArchivedPristine = false;
    //         await browser.tabs.remove(tidsToRemove);
    //     }
    //     // Case: Dead -> Live
    //     else if (sourceIsClosed && !targetIsClosed) {
    //         this._setParent(bruhId, newParentId);
    //         const subtreeIds = this._getSubtree(bruhId);
    //         const targetWid = this.get_window(targetRootWindowId).win.wid;
    //         for (const id of subtreeIds) {
    //             const nodeData = this.get_tab_node(id);
    //             const newTab = await browser.tabs.create({
    //                 url: nodeData.tab.url,
    //                 index,
    //                 windowId: targetWid,
    //                 active: false,
    //                 discarded: true,
    //                 title: this.get_node_name(nodeData.node.id),
    //             });
    //             nodeData.tab.tid = newTab.id! as TabId;
    //             nodeData.tab.closed = false;
    //             this._addTabToWindow(newTab.id! as TabId, targetWid, newTab.index);
    //             await this._writeSessionPointer(id, newTab.id! as TabId, 'tab');
    //             index++;
    //         }
    //         this._setNodeClosedState(bruhId, false);
    //         if (sourceRootWindowId) this.get_window(sourceRootWindowId).win.isArchivedPristine = false;
    //     }
    //     // Case: Live -> Live
    //     else {
    //         await this._reparentNode(bruhId, newParentId, index);
    //         return;
    //     }

    //     // TODO:
    //     // this._removeTabFromWindow(sourceNode.tid, rootWindowId);
    //     // this._addTabToWindow(tid, newWindowData.win.wid, i);
    // }

    private async _cloneNode(originalNodeId: BruhId, newParentId: BruhId, windowId: WindowId): Promise<void> {
        const originalNodeData = this.get_node(originalNodeId);
        const originalTab = originalNodeData.node.type !== 'window' ? (originalNodeData as TabData).tab : null;

        const newBruhId = this.bruhid++ as BruhId;
        let url: string | undefined;
        if (originalNodeData.node.type == "group") {
            this.groupAttrs.set(newBruhId, { ...this.groupAttrs.get(originalNodeId)! });
            url = this._getGroupUrl(newBruhId);
        } else {
            url = originalTab?.url;
        }
        const newTab = await browser.tabs.create({
            windowId,
            url: url,
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

        this.tree.set(newBruhId, node);
        this.tabs.set(newTab.id! as TabId, bruhTab);
        await this._writeSessionPointer(newBruhId, newTab.id! as TabId, 'tab');
        this._addTabToWindow(newTab.id! as TabId, windowId, newTab.index);

        const children = this._getChildrenMap().get(originalNodeId) || [];
        for (const childId of children) {
            await this._cloneNode(childId, newBruhId, windowId);
        }
    }

    private async _restoreBruhWindow(bruhId: BruhId): Promise<void> {
        const originalWindowData = this.get_window_node(bruhId);
        const newBrowserWindow = await browser.windows.create({});
        const newWindowData = await this._createWindowNode(newBrowserWindow.id! as WindowId);

        this.groupAttrs.set(newWindowData.node.id, { ...this.groupAttrs.get(bruhId)! });

        const children = this._getChildrenMap().get(bruhId) || [];
        for (const childId of children) {
            await this._cloneNode(childId, newWindowData.node.id, newWindowData.win.wid);
        }

        const extraTabId = newBrowserWindow.tabs![0]!.id! as TabId;
        this.forget_tab_ids.add(extraTabId);

        // the corresponding adding/removal from window state is done in the resp. browser events.
        await browser.tabs.remove(extraTabId);

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
        // if no restore cache, we can't restore anyway.
        if (!bruhId || !this.browserRestoreCache.has(bruhId)) {
            return await this._createWindowNode(wid);
        }

        const cacheData = this.browserRestoreCache.get(bruhId) as Extract<NodeStorageData, { type: "window" }>;

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
            bruhWin.tabIds = [];
            node.wid = wid;

            // Move the entry in the `windows` map from the old ID to the new ID.
            this.windows.set(wid, bruhWin);
            if (oldWid !== wid) {
                this.windows.delete(oldWid);
            }

            // The window is now live, so we can clear its entry from the restore cache.
            this.browserRestoreCache.delete(bruhId);

            return { node, win: bruhWin };
        } else {
            // non-pristine restore. we treat this as a new window, but use state from restore cache
            const bid = this.bruhid++ as BruhId;
            const node: Extract<Node, { type: "window" }> = {
                id: bid,
                hgid: cacheData.hgid,
                parentId: 0 as BruhId & 0,
                collapsed: false,
                type: "window",
                wid: wid,
            };

            const bruhWin: BruhWindow = {
                id: bid,
                wid: wid,
                tabIds: [],
                closed: false,
            };

            const attrs = cacheData?.groupAttrs || { name: this._generateUniqueGroupName(), generation: bid, isCustomNamed: false };
            this.groupAttrs.set(bid, attrs);

            this.tree.set(bid, node);
            this.windows.set(wid, bruhWin);
            await this._writeSessionPointer(bid, wid, 'window');
            this.browserRestoreCache.delete(bruhId); // Clear the cache entry.

            const new_ids = new Map();
            this.pre_allocated_ids_for_non_pristine_restore.set(wid, { ids: new_ids, left_to_restore: new Set(cacheData.tab_bids) });
            new_ids.set(cacheData.bruhId, bid);
            for (let tbid of cacheData.tab_bids) {
                let new_tbid = this.bruhid++ as BruhId;
                new_ids.set(tbid, new_tbid);
            }

            return { node, win: bruhWin };
        }
    }

    private async _createOrRestoreTab(bruhId: BruhId, browserTab: browser.Tabs.Tab): Promise<void> {
        const cacheData = this.browserRestoreCache.get(bruhId) as Exclude<NodeStorageData, { type: "window" }>;
        if (!cacheData) {
            // This tab was not in our cache, so treat it as entirely new.
            await this._createTabNode(browserTab, { id: bruhId });
            this._addTabToWindow(browserTab.id as TabId, browserTab.windowId as WindowId, browserTab.index);
            return;
        }

        // TODO: browser restore of a window after a bruh restore breaks the state in restored tabs
        // TODO: browser restore after editing closed windows results in errors
        // TODO: reparenting/child reclamation does not work for non-pristine restores as BruhIds are all updated to something else

        const wid = browserTab.windowId as WindowId;
        const existingNodeData = this.tree.has(bruhId) ? this.get_node(bruhId) : null;
        let isPristine = !this.pre_allocated_ids_for_non_pristine_restore.has(wid);
        const new_ids = this.pre_allocated_ids_for_non_pristine_restore.get(wid)?.ids ?? new Map();
        const bid = new_ids.get(bruhId) ?? bruhId;

        if (existingNodeData && isPristine) {
            // seamless restore
            this._setNodeClosedState(bruhId, false);
            const tabData = this.get_tab_node(bruhId);
            const newTid = browserTab.id! as TabId;
            const newWid = browserTab.windowId! as WindowId;
            const oldTid = tabData.tab.tid;

            // Update the BruhTab object with its new live properties.
            tabData.tab.tid = newTid;
            tabData.node.tid = newTid;
            tabData.tab.wid = newWid;
            tabData.tab.index = browserTab.index;

            // update the tid -> tab mapping
            this.tabs.set(newTid, tabData.tab);
            this.tabs.delete(oldTid);

            // update tid in window
            this._addTabToWindow(newTid, newWid, tabData.tab.index);
            this._reindexWindowTabs(wid);

            // Write the session pointer and clear the cache entry for this now-live node.
            await this._writeSessionPointer(bruhId, newTid, 'tab');
            this.browserRestoreCache.delete(bruhId);
        } else {
            // non-pristine restore
            // The user has edited the session, so we restore this tab as a new entity, but use data from restore cache
            await this._writeSessionPointer(bid, browserTab.id as TabId, 'tab');
            this.browserRestoreCache.delete(bruhId);
            if (this.pre_allocated_ids_for_non_pristine_restore.has(wid)) {
                this.pre_allocated_ids_for_non_pristine_restore.get(wid)!.left_to_restore.delete(bruhId);
            }

            const parent_id = new_ids.get(cacheData.parentId) ?? cacheData.parentId;
            if ("groupAttrs" in cacheData) {
                this.groupAttrs.set(bid, { ...cacheData.groupAttrs });
            }

            const node: Extract<Node, { type: "tab" | "group" }> = {
                id: bid,
                hgid: cacheData.hgid,
                parentId: parent_id,
                collapsed: false,
                type: cacheData.type,
                tid: browserTab.id as TabId,
            };

            const bruhTab: BruhTab = {
                id: node.id,
                tid: node.tid,
                wid: wid,
                index: browserTab.index,
                url: (cacheData.type == "tab") ? cacheData.url : this._getGroupUrl(node.id),
                title: (cacheData.type == "tab") ? cacheData.title : this.groupAttrs.get(node.id)!.name,
                favIconUrl: browserTab.favIconUrl,
                discarded: browserTab.discarded ?? false,
                active: browserTab.active,
                closed: false,
            };
            this.tree.set(node.id, node);
            this.tabs.set(node.tid, bruhTab);
            if (browserTab.url !== bruhTab.url) {
                await browser.tabs.update(node.tid, { url: bruhTab.url });
            }

            // reparent the restored tab.
            if (this.tree.has(parent_id) && isPristine) {
                const orderedTabs = this._getOrderedTabList(browserTab.windowId as WindowId);
                let index = orderedTabs.length;
                for (let tbid of cacheData.comesAfterIds.toReversed()) {
                    const i = orderedTabs.indexOf(new_ids.get(tbid) ?? tbid);
                    if (i != -1) {
                        index = i + 1;
                        break;
                    }
                }
                this._setParent(bid, parent_id);
                this._addTabToWindow(browserTab.id as TabId, browserTab.windowId as WindowId, index);
                this._reindexWindowTabs(wid);
            } else {
                this._addTabToWindow(browserTab.id as TabId, browserTab.windowId as WindowId, cacheData.index);
                this._reindexWindowTabs(wid);
            }

            // child reclamation
            for (const _childId of cacheData.childrenIds) {
                const childId = new_ids.get(_childId) ?? _childId;
                if (this.tree.has(childId)) {
                    const childNode = this.get_tab_node(childId).node;
                    // only restore if the archieve was done after this child was repositioned manually
                    if (childNode.hgid <= cacheData.cache_hgid) {
                        this._setParent(childId, bid);
                    }
                }
            }
        }

        if (this.pre_allocated_ids_for_non_pristine_restore.get(wid)?.left_to_restore?.size == 0) {
            this.pre_allocated_ids_for_non_pristine_restore.delete(wid);
        }
    }

    private async _createTabNode(tab: browser.Tabs.Tab, options?: { id?: BruhId, hgid?: HierarchyGenerationId, closed?: boolean }): Promise<TabData> {
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
            hgid: options?.hgid ?? this._incrementHgid(),
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
            closed: options?.closed ?? false,
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
        if (!options?.closed) {
            await this._writeSessionPointer(bruhId, tid, 'tab');
        }

        if (isGroup) {
            const correctUrl = this._getGroupUrl(bruhId);
            bruhTab.url = correctUrl;
            if (!options?.closed) {
                await browser.tabs.update(tid, { url: correctUrl });
            }
        }

        return { node, tab: bruhTab };
    }

    private async _createWindowNode(wid: WindowId, options?: { id?: BruhId, closed?: boolean }): Promise<WindowData> {
        const bruhId = options?.id ?? this.bruhid++ as BruhId;

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
            closed: options?.closed ?? false,
        };

        const attrs: GroupAttrs = { name: this._generateUniqueGroupName(), generation: bruhId, isCustomNamed: false };
        this.groupAttrs.set(bruhId, attrs);

        this.tree.set(bruhId, node);
        this.windows.set(wid, bruhWin);
        if (!options?.closed) {
            await this._writeSessionPointer(bruhId, wid, 'window');
        }
        return { node, win: bruhWin };
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

    private async _moveSubtreeToNewWindow(rootNodeId: BruhId): Promise<void> {
        const rootNodeData = this.get_node(rootNodeId);
        if (rootNodeData.node.type === 'window') return;
        if (rootNodeData.node.type == "group") {
            await this._convertGroupToWindow(rootNodeId);
            return;
        }

        const is_closed = this.is_node_closed(rootNodeId);

        const subtreeIds = this._getSubtree(rootNodeId);
        const tidsToMove = subtreeIds
            .map(id => this.get_tab_node(id).tab.tid);

        const rootTabTid = tidsToMove[0];
        const rootWindowId = this.get_node_wid(rootNodeId);

        const bid = this.bruhid++ as BruhId;
        let newWindowId: WindowId;
        let extraTabId: TabId | undefined;
        if (is_closed) {
            newWindowId = -bid as WindowId;
            this.get_window(rootWindowId).win.isArchivedPristine = false;
        } else {
            const newBrowserWindow = await browser.windows.create();
            extraTabId = newBrowserWindow.tabs![0]!.id! as TabId;
            newWindowId = newBrowserWindow.id! as WindowId;
        }

        const newWindowData = await this._createWindowNode(newWindowId, { id: bid, closed: is_closed });

        if (!is_closed) {
            await browser.tabs.move(tidsToMove, { windowId: newWindowId, index: 0 });

            await browser.tabs.update(rootTabTid, { active: true });
            this.forget_tab_ids.add(extraTabId!);
            await browser.tabs.remove(extraTabId!);
        }

        for (let i = 0; i < tidsToMove.length; i++) {
            let tid = tidsToMove[i]!;
            this._removeTabFromWindow(tid, rootWindowId);
            this._addTabToWindow(tid, newWindowData.win.wid, i);
        }

        this._setParent(rootNodeId, newWindowData.node.id);
        rootNodeData.node.hgid = this._incrementHgid();
    }

    private async _convertGroupToWindow(groupId: BruhId): Promise<void> {
        const groupData = this.get_tab_node(groupId);
        const groupAttrs = this.groupAttrs.get(groupId)!;
        const childrenIds = this._getChildrenMap().get(groupId) || [];
        const tidsToMove = this._getSubtree(groupId).splice(1).map(bid => this.get_tab_node(bid).tab.tid);
        const is_closed = this.is_node_closed(groupId);

        let bid = this.bruhid++ as BruhId;
        let newWindowId: WindowId;
        if (is_closed) {
            newWindowId = -bid as WindowId;
            this._removeTabFromWindow(groupData.tab.tid, groupData.tab.wid);
            this._removeNodeAndReparentChildren(groupData.tab.id);
            this.get_window(groupData.tab.wid).win.isArchivedPristine = false;
        } else {
            const newBrowserWindow = await browser.windows.create();
            const extraTabId = newBrowserWindow.tabs![0]!.id! as TabId;
            newWindowId = newBrowserWindow.id! as WindowId;

            if (tidsToMove.length > 0) {
                await browser.tabs.move(tidsToMove, { windowId: newWindowId, index: 0 });
                await browser.tabs.update(tidsToMove[0], { active: true });
            }

            this.forget_tab_ids.add(extraTabId);
            await browser.tabs.remove(extraTabId);
        }

        // hgid changed while creating this window node
        const newWindowData = await this._createWindowNode(newWindowId, { id: bid, closed: is_closed });
        this.groupAttrs.set(newWindowData.node.id, { ...groupAttrs });

        for (let i = 0; i < tidsToMove.length; i++) {
            let tid = tidsToMove[i]!;
            this._removeTabFromWindow(tid, groupData.tab.wid);
            this._addTabToWindow(tid, newWindowData.win.wid, i);
        }

        if (is_closed) {
            newWindowData.win.isArchivedPristine = false;
        } else {
            await browser.tabs.remove(groupData.tab.tid);
        }

        for (const childId of childrenIds) {
            this._setParent(childId, newWindowData.node.id);
        }
    }

    private async _convertWindowToGroup(sourceBruhId: BruhId, targetParentId: BruhId, index: number): Promise<void> {
        const targetWindowId = this.get_node_wid(targetParentId);
        const sourceWindowData = this.get_window_node(sourceBruhId);
        const sourceWindowId = sourceWindowData.win.wid;
        const sourceGroupAttrs = this.groupAttrs.get(sourceBruhId)!;

        const is_closed = this.is_node_closed(sourceWindowData.node.id);
        const is_target_closed = this.is_node_closed(targetParentId);

        const childBruhIds = this._getSubtree(sourceBruhId).splice(1);
        const childTids = childBruhIds.map(bid => this.get_tab_node(bid).tab.tid);

        const bid = this.bruhid++ as BruhId;
        this.groupAttrs.set(bid, { ...sourceGroupAttrs });
        const newGroupUrl = this._getGroupUrl(bid);
        let newGroupBrowserTab: browser.Tabs.Tab;
        if (is_target_closed) {
            newGroupBrowserTab = {
                id: -bid,
                windowId: targetWindowId,
                highlighted: false,
                index: index,
                active: false,
                pinned: false,
                discarded: true,
                incognito: false,
                title: newGroupUrl,
                url: sourceGroupAttrs.name,
            };
            this.get_window(targetWindowId).win.isArchivedPristine = false;
        } else {
            newGroupBrowserTab = await browser.tabs.create({
                windowId: targetWindowId,
                index: index,
                url: newGroupUrl,
                active: false,
                discarded: true,
                title: sourceGroupAttrs.name,
            });
        }
        const newGroupTid = newGroupBrowserTab.id! as TabId;

        if (childTids.length > 0) {
            if (!is_closed && !is_target_closed) {
                await browser.tabs.move(childTids, { windowId: targetWindowId, index: index + 1 });

                // for (let i = 0; i < childTids.length; i++) {
                //     let tid = childTids[i];
                //     sourceWindowData.win.tabIds.splice(index + i + 1, 0, newGroupBrowserTab.id as TabId);
                // }
            } else if (!is_closed && is_target_closed) {
                await browser.tabs.remove(childTids);
            } else if (is_closed && !is_target_closed) {
                // TODO:
                // for 
            } else {
                // nothing
            }
        }

        const newNode: Node = {
            type: "group",
            id: bid,
            tid: newGroupTid,
            collapsed: false,
            parentId: targetParentId,
            hgid: this._incrementHgid(),
        };

        const newBruhTab: BruhTab = {
            id: bid,
            tid: newGroupTid,
            wid: targetWindowId,
            index: index,
            url: newGroupUrl,
            title: sourceGroupAttrs.name,
            favIconUrl: undefined,
            discarded: true,
            active: false,
            closed: is_target_closed,
        };
        this.tabs.set(newGroupTid, newBruhTab);
        this.tree.set(bid, newNode);
        this.remove_window(sourceWindowId);
        this._addTabToWindow(newNode.tid, targetWindowId, index);

        for (let i = 0; i < childTids.length; i++) {
            const childId = childTids[i]!;
            this._addTabToWindow(childId, targetWindowId, index + 1 + i);
            const child = this.get_tab(childId);
            if (child.node.parentId == sourceBruhId) {
                this._setParent(child.node.id, bid);
            }
        }

        if (!is_target_closed) {
            await this._writeSessionPointer(bid, newGroupTid, 'tab');
        }
    }

    private async _saveState(): Promise<void> {
        const nodeStorage: Record<string, NodeStorageData> = {};
        const childrenMap = this._getChildrenMap();

        for (const [bruhId, node] of this.tree.entries()) {
            const wid = this.get_node_wid(bruhId);
            // this can happen when we do a pristine restore of a window, but the tabs haven't been migrated yet.
            if (!this.windows.has(wid)) continue;
            const storageNode: NodeStorageData = {
                bruhId: bruhId,
                hgid: node.hgid,
                windowBid: this.get_window(wid).node.id,
                cache_hgid: node.hgid,
                collapsed: node.collapsed,
                type: node.type,
                parentId: node.type === 'window' ? (0 as BruhId) : node.parentId,
                ancestorIds: this._getAncestors(bruhId),
                childrenIds: childrenMap.get(bruhId) || [],
                comesAfterIds: this._getTabsBefore(bruhId),
                // @ts-ignore
                groupAttrs: (node.type === 'group' || node.type === 'window') ? this.groupAttrs.get(bruhId) : undefined,
                // @ts-ignore
                url: node.type === 'tab' ? this.get_tab_node(bruhId).tab.url : undefined,
                // @ts-ignore
                title: node.type === 'tab' ? this.get_tab_node(bruhId).tab.title : undefined,
                // @ts-ignore
                tab_bids: (node.type === 'window') ? this._getOrderedTabList(node.wid) : undefined,
                // @ts-ignore
                index: (node.type === "window") ? undefined : this.get_tab_node(bruhId).tab.index,
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

                let url: string;
                let title: string;
                if (storageNode.type === 'group') {
                    this.groupAttrs.set(bruhId, storageNode.groupAttrs);
                    title = storageNode.groupAttrs.name;
                    url = this._getGroupUrl(bruhId);
                } else {
                    title = storageNode.title;
                    url = storageNode.url;
                }

                this.tabs.set(tid, {
                    id: bruhId,
                    tid: tid,
                    wid: -storageNode.windowBid as WindowId,
                    index: storageNode.comesAfterIds.length,
                    url,
                    title,
                    active: false,
                    discarded: true,
                    closed: true,
                });
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
                    this._addTabToWindow(tab.id as TabId, tab.windowId as WindowId, tab.index);
                }
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
                if (!this.windows.has(detachInfo.oldWindowId as WindowId)) {
                    return;
                }
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

                    const subtreeIds = this._getSubtree(winData.win.id);
                    for (const id of subtreeIds) {
                        this._archiveNode(id);
                    }

                    if (closedTabs.size <= 1) {
                        // This was a single-tab window close, treat as permanent removal.
                        for (const id of subtreeIds) {
                            this.remove_node(id);
                        }
                    }
                } else {
                    // The window was removed without preceding tabRemoved events (e.g., via another extension).
                    // Safest action is to treat it as restorable.
                    this._archiveNode(winData.win.id);
                }
            } break;
            case 'windowFocusChanged': { } break;
            case 'sessionsChanged': {
                const sessions = await browser.sessions.getRecentlyClosed();
                if (this.config.dbg.log_sessions) {
                    console.log(sessions);
                }
                for (let session of sessions) {
                    if (session.tab && session.tab.id !== undefined && session.tab.sessionId && session.tab.windowId !== undefined) {
                        if (this.forget_tab_ids.has(session.tab.id as TabId)) {
                            this.forget_tab_ids.delete(session.tab.id as TabId);
                            await browser.sessions.forgetClosedTab(session.tab.windowId, session.tab.sessionId);
                        }
                    }
                }
            } break;
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
                        // TODO: handle closed windows
                        const { dragData, targetNodeId, action } = message.payload;
                        const { node: targetNode } = this.get_node(targetNodeId);
                        const { node: draggedNode } = this.get_node(dragData.draggedNodeId);
                        const targetWindowId = this.get_node_wid(targetNodeId);

                        draggedNode.hgid = this._incrementHgid();

                        const target = this._getTargetIndex(dragData.draggedNodeId, targetNodeId, action);

                        // Special case: a dead or live window is dropped into a live window, converting it to a group
                        if (draggedNode.type === 'window' && !this.get_window(targetWindowId).win.closed) {
                            await this._convertWindowToGroup(dragData.draggedNodeId, target.parentId, target.index);
                            break; // Finish here for this special case
                        }

                        const sourceIsClosed = this.is_node_closed(draggedNode.id);
                        const targetIsClosed = this.is_node_closed(targetNode.id);

                        // This is a pure UI re-ordering within a live window.
                        if (!sourceIsClosed && !targetIsClosed) {
                            await this._reparentNode(dragData.draggedNodeId, target.parentId, target.index);
                        } else { // All other cases involve state changes (Live->Dead, Dead->Live, Dead->Dead)
                            // The universal _moveNode handles the complex state transitions
                            await this._moveNode(dragData.draggedNodeId, target.parentId, target.index);
                        }
                    } break; case 'FOCUS_TAB': {
                        const { tid } = this.get_tab_node(message.payload.nodeId).tab;
                        await browser.tabs.update(tid, { active: true });
                    } break;
                    case 'CLOSE_SUBTREE': {
                        const tabs = this._getSubtree(message.payload.nodeId)
                            .map(id => this.get_node(id).node)
                            .filter(n => n.type !== 'window')
                            .map(n => (n as Extract<Node, { type: 'tab' | 'group' }>));
                        const win = this.get_window(this.get_node_wid(message.payload.nodeId)).win;
                        if (tabs.length > 0) {
                            if (win.closed) {
                                for (let tab of tabs) {
                                    this._removeTabFromWindow(tab.tid, win.wid);
                                    this._removeNodeAndReparentChildren(tab.id);
                                }
                                win.isArchivedPristine = false;
                            } else {
                                await browser.tabs.remove(tabs.map(t => t.id));
                            }
                        }
                    } break;
                    case 'CLOSE_SINGLE_TAB': {
                        const tab = this.get_tab_node(message.payload.nodeId).tab;
                        if (tab.closed) {
                            this._removeTabFromWindow(tab.tid, tab.wid);
                            this._removeNodeAndReparentChildren(tab.id);
                            this.get_window(tab.wid).win.isArchivedPristine = false;
                        } else {
                            await browser.tabs.remove(tab.tid);
                        }
                    } break;
                    case 'DUPLICATE_TAB_SMART': {
                        const { tab: originalTab, node: originalNode } = this.get_tab_node(message.payload.nodeId);
                        const index = originalTab.index;
                        const bid = this.bruhid++ as BruhId;
                        let newTab: browser.Tabs.Tab;
                        if (originalTab.closed) {
                            newTab = {
                                id: -bid,
                                windowId: originalTab.wid,
                                highlighted: false,
                                index: index,
                                active: false,
                                pinned: false,
                                discarded: true,
                                incognito: false,
                                title: originalTab.title,
                                url: originalTab.url,
                            };
                            this.get_window(originalTab.wid).win.isArchivedPristine = false;
                        } else {
                            newTab = await browser.tabs.create({
                                windowId: originalTab.wid,
                                url: originalTab.url,
                                active: false,
                                discarded: true,
                                title: this.get_node_name(originalTab.id),
                                index: index,
                            });
                        }
                        const { tab: newBruhTab } = await this._createTabNode(newTab, { id: bid, closed: originalTab.closed });
                        this._addTabToWindow(newBruhTab.tid, newBruhTab.wid, index);
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
                        const wid = message.payload.windowId;

                        const bid = this.bruhid++ as BruhId;
                        let newTab: browser.Tabs.Tab;
                        const target = this._getTargetIndex(bid, message.payload.parentId, "inside");
                        const win = this.get_window(wid).win;
                        if (win.closed) {
                            newTab = {
                                id: -bid,
                                windowId: wid,
                                highlighted: false,
                                index: target.index,
                                active: false,
                                pinned: false,
                                discarded: true,
                                incognito: false,
                                title: "New Tab",
                                url: browser.runtime.getURL('new.html'),
                            };
                            win.isArchivedPristine = false;
                        } else {
                            newTab = await browser.tabs.create({ windowId: wid, active: false, discarded: true, title: "New Tab", index: target.index, url: browser.runtime.getURL('new.html') });
                        }
                        const { tab } = await this._createTabNode(newTab, { id: bid, closed: win.closed });

                        this._addTabToWindow(tab.tid, tab.wid, tab.index);
                        this._setParent(tab.id, win.id);
                    } break;
                    case 'CREATE_TAB_FROM_URL': {
                        const { url, windowId, parentId, action } = message.payload;
                        const bid = this.bruhid++ as BruhId;
                        const target = this._getTargetIndex(bid, parentId, action);
                        const win = this.get_window(windowId).win;
                        let newTab: browser.Tabs.Tab;
                        if (win.closed) {
                            newTab = {
                                id: -bid,
                                windowId: windowId,
                                url: url,
                                highlighted: false,
                                index: target.index,
                                active: false,
                                pinned: false,
                                discarded: true,
                                incognito: false,
                                title: (new URL(url)).host,
                            };
                            win.isArchivedPristine = false;
                        } else {
                            newTab = await browser.tabs.create({ windowId, url, active: false, discarded: true, index: target.index });
                        }
                        const { tab } = await this._createTabNode(newTab, { id: bid, closed: win.closed });

                        this._addTabToWindow(tab.tid, tab.wid, tab.index);
                        this._setParent(bid, parentId);
                    } break;
                    case 'CLOSE_WINDOW': {
                        await browser.windows.remove(message.payload.windowId);
                    } break;
                    case 'RESTORE_WINDOW': {
                        const { win } = this.get_window(message.payload.windowId);
                        await this._restoreBruhWindow(win.id);
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
                        this._flattenNode(message.payload.nodeId, false, this._incrementHgid());
                        if (this.is_node_closed(message.payload.nodeId)) {
                            const win = this.get_window(this.get_node_wid(message.payload.nodeId));
                            win.win.isArchivedPristine = false;
                        }
                    } break;
                    case 'FLATTEN_TREE': {
                        this._flattenNode(message.payload.nodeId, true, this._incrementHgid());
                        if (this.is_node_closed(message.payload.nodeId)) {
                            const win = this.get_window(this.get_node_wid(message.payload.nodeId));
                            win.win.isArchivedPristine = false;
                        }
                    } break;
                    case 'CREATE_GROUP': {
                        const { windowId, parentId } = message.payload;
                        const bid = this.bruhid++ as BruhId;
                        const attrs = { name: this._generateUniqueGroupName(), isCustomNamed: false, generation: bid };
                        this.groupAttrs.set(bid, attrs);
                        const win = this.get_window(windowId).win;
                        const target = this._getTargetIndex(bid, parentId, "inside");
                        let groupTab: browser.Tabs.Tab;
                        if (win.closed) {
                            groupTab = {
                                id: -bid,
                                windowId: windowId,
                                url: this._getGroupUrl(bid),
                                highlighted: false,
                                index: target.index,
                                active: false,
                                pinned: false,
                                discarded: true,
                                incognito: false,
                                title: attrs.name,
                            };
                            win.isArchivedPristine = false;
                        } else {
                            groupTab = await browser.tabs.create({
                                windowId,
                                active: false,
                                discarded: true,
                                title: "Tabruh Group",
                                url: this._getGroupUrl(bid),
                                index: target.index,
                            });
                        }
                        const { tab } = await this._createTabNode(groupTab, { id: bid, closed: win.closed });
                        this._addTabToWindow(tab.tid, tab.wid, tab.index);
                        this._reparentNode(tab.id, parentId, target.index);
                    } break;
                    case 'RENAME_WINDOW': {
                        const { windowId, newName } = message.payload;
                        const win = this.get_window(windowId);
                        const attrs = this.groupAttrs.get(win.win.id)!;
                        attrs.name = newName;
                        attrs.isCustomNamed = true;
                        if (win.win.closed) {
                            win.win.isArchivedPristine = false;
                        }
                    } break;
                    case 'RENAME_NODE': {
                        const { nodeId, newName } = message.payload;
                        const { node, tab } = this.get_tab_node(nodeId);
                        const win = this.get_window(tab.wid);
                        const attrs = this.groupAttrs.get(nodeId)!;
                        attrs.name = newName;
                        attrs.isCustomNamed = true;
                        tab.title = newName;
                        if (node.type === 'group') {
                            const newUrl = this._getGroupUrl(nodeId);
                            if (tab.closed) {
                                tab.url = newUrl;
                                win.win.isArchivedPristine = false;
                            } else {
                                await browser.tabs.update(tab.tid, { url: newUrl });
                            }
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
