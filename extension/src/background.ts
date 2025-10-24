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
    StorageState,
} from './types';
import * as utils from './utils';
import manifest from './manifest.jsonc';

type Config = {
    available_apis: {
        session_values: boolean,
    },
    features: {
        restore_strategy: "SessionsValues" | "SessionHistory",
    },
};
type UserConfig = {
    dbg_reset_state_on_load: boolean,
    dbg_log_events: boolean,
    dbg_log_effects: boolean,
    open_sidebar_on_new_windows: boolean,
};
type ConfigStorage = {
    config_version: string,
    user_config: UserConfig,
};

class App {
    ports: Set<browser.Runtime.Port> = new Set();
    eventChannel: utils.Channel<StateManagerEvent> = new utils.Channel();

    config: Config;
    user_config: UserConfig;
    extension_version: string;
    bruh_session_key: string;
    bruhid: BruhId = 1 as BruhId;
    hierarchy_generation_id: HierarchyGenerationId = 1 as HierarchyGenerationId;

    window_ids: Map<BruhId, WindowId> = new Map();
    tab_ids: Map<BruhId, TabId> = new Map();
    window_bids: Map<WindowId, BruhId> = new Map();
    tab_bids: Map<TabId, BruhId> = new Map();
    nodes: Map<BruhId, Node> = new Map();
    tab_name_cache: Map<BruhId, GroupName> = new Map();
    browser_restore_cache: Map<BruhId, NodeStorageData> = new Map();

    // win -> []tab
    closing_window_tabs: Map<BruhId, Set<BruhId>> = new Map();
    // win -> _
    pre_allocated_bids_for_non_pristine_restore: Map<BruhId, {
        ids: Map<BruhId, BruhId>,
        left_to_restore: Set<BruhId>,
    }> = new Map();
    forget_tids: Set<TabId> = new Set();
    forget_wids: Set<WindowId> = new Set();

    private session_pointer_key = "tabruh-bruh-id";
    private storage_state_key = "tabruh-app-state";
    private storage_config_key = "tabruh-app-config";

    private adjectives = ["Agile", "Azure", "Blue", "Bold", "Bright", "Calm", "Clever", "Cool", "Crimson", "Eager", "Emerald", "Golden", "Green", "Happy", "Jade", "Jolly", "Keen", "Light", "Lime", "Lucky", "Magic", "Mega", "Navy", "New", "Noble", "Olive", "Orange", "Ornate", "Proud", "Purple", "Quick", "Quiet", "Red", "Regal", "Rose", "Ruby", "Silver", "Sky", "Solar", "Teal", "Topaz", "Urban", "Vivid", "Warm", "White", "Wise", "Yellow", "Zen"];
    private nouns = ["Alpaca", "Ant", "Ape", "Bear", "Bee", "Bird", "Bison", "Cat", "Clam", "Cobra", "Crane", "Crow", "Deer", "Dog", "Dove", "Duck", "Eagle", "Elk", "Emu", "Finch", "Fish", "Fly", "Fox", "Frog", "Goat", "Goose", "Hawk", "Hen", "Heron", "Ibex", "Ibis", "Jay", "Kite", "Kiwi", "Lark", "Lion", "Llama", "Mole", "Moth", "Mouse", "Mule", "Newt", "Owl", "Panda", "Puma", "Quail", "Rabbit", "Ram", "Rat", "Raven", "Rhino", "Rook", "Seal", "Shark", "Skunk", "Sloth", "Snail", "Stork", "Swan", "Tiger", "Toad", "Tuna", "Viper", "Wasp", "Wolf", "Wren", "Yak", "Zebra"];

    constructor(version: string) {
        this.extension_version = version;

        const session_values = browser.sessions.setWindowValue !== undefined;
        this.config = {
            available_apis: {
                session_values: session_values,
            },
            features: {
                restore_strategy: session_values ? "SessionsValues" : "SessionHistory",
            },
        };

        this.user_config = {
            dbg_reset_state_on_load: false,
            dbg_log_events: true,
            dbg_log_effects: true,
            open_sidebar_on_new_windows: false,
        };

        // just a random number that can uniquely identify the storage data saved by *this* tabruh and not some broken version.
        // TODO: maybe use uuid of some kind
        this.bruh_session_key = Math.random().toString();
    }

    static init() {
        const version = manifest["version"];
        console.log(`tabruh loaded: v${version}`);

        let self = new App(version);
        return self;
    }

    attach_listeners() {
        browser.runtime.onInstalled.addListener(async () => {
            browser.menus.create({
                id: "open-overview",
                title: "Overview Page",
                contexts: ["browser_action"],
            });
            browser.menus.create({
                id: "clear-state",
                title: "Clear state",
                contexts: ["all"],
            });

            for (const key in this.user_config) {
                // @ts-ignore
                const val = this.user_config[key];
                if (typeof val === "boolean") {
                    browser.menus.create({
                        id: key,
                        type: "checkbox",
                        title: {}[key] ?? key,
                        contexts: ["all"],
                        checked: val,
                    });
                }
            }
        });
        browser.menus.onClicked.addListener(async (info, tab) => {
            switch (info.menuItemId) {
                case "open-overview": {
                    await browser.tabs.create({
                        url: browser.runtime.getURL("overview.html"),
                    });
                } break;
                case "clear-state": {
                    await browser.storage.local.remove(this.storage_config_key);
                    await browser.storage.local.remove(this.storage_state_key);
                } break;
                default:
                    console.warn("unknown menu item id " + info.menuItemId);
            }

            for (const key in this.user_config) {
                if (key != info.menuItemId) continue;
                // @ts-ignore
                this.user_config[key] = !this.user_config[key];
            }

            for (const key in this.user_config) {
                if (key != info.menuItemId) continue;
                await browser.menus.update(key, {
                    // @ts-ignore
                    checked: this.user_config[key],
                });
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

    is_group_tab(tab: browser.Tabs.Tab): boolean {
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
            case 'sessions_changed':
                console.log(Date.now(), event.type, event.payload);
                break;
            case 'tab_updated':
            case 'tab_activated':
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
                    case 'close_tabs':
                    case 'duplicate_tab':
                    case 'unload_tabs':
                    case 'reload_tree':
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

    _log_effect(effect: BrowserEffect) {
        switch (effect.type) {
            case 'effects':
            case 'node_removed':
            case 'tab_created':
            case 'tab_focused':
            case 'tabs_moved':
            case 'tabs_discarded':
            case 'tabs_reloaded':
            case 'tabs_closed':
            case 'window_created':
            case 'window_closed':
                console.log(Date.now(), effect.type, effect.payload);
                break;
            default:
                throw utils.exhausted(effect);
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
                    case 'close_tabs':
                    case 'duplicate_tab':
                    case 'unload_tabs':
                    case 'reload_tree':
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
        const effects = new utils.Deque<BrowserEffect>();
        while (true) {
            const event = await this.eventChannel.wait_recv();
            if (!event) break;

            if (this.user_config.dbg_log_events) {
                this._log_event(event);
            }

            await this._process_event(event, effects).catch(console.error);
            await this.process_effects(effects);
            await this.save_state().catch(console.error);

            this._broadcast_updates(event);
        }
    }

    async process_effects(effects: utils.Deque<BrowserEffect>) {
        while (true) {
            const effect = effects.pop_front();
            if (!effect) break;

            if (this.user_config.dbg_log_effects) {
                this._log_effect(effect);
            }
            await this._process_effect(effects, effect).catch(console.error);
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
        const index_map = new Map<BruhId, number>();
        const map = new Map<BruhId, BruhId[]>();
        for (const [_, node] of this.nodes) {
            if (!map.has(node.parent_bid)) {
                map.set(node.parent_bid, []);
            }
            map.get(node.parent_bid)!.push(node.bid);
            index_map.set(node.bid, this.get_index(node.bid));
        }
        for (const [_, nodes] of map) {
            nodes.sort((a, b) => index_map.get(a)! - index_map.get(b)!);
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
        const node = this.get_node(bid);
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
        // const tab = this.get_tab(tbid);
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
        const tab = this.get_node(tbid);
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

        tab.wbid = wbid;
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
            cached_group_name: node.type == "tab" ? this.tab_name_cache.get(node.bid) : undefined,
            type: node.type,
        } as NodeStorageData;

        return storageData;
    }

    archive_node(bid: BruhId): void {
        const snapshot = this.get_node_storage_data(bid);
        this.browser_restore_cache.set(bid, snapshot);

        const node = this.get_node(bid);
        if (node.type === 'window') {
            node.is_archived_pristine = true;
        }
    }

    get_target_index(bid: BruhId, target_bid: BruhId, position: DropAction) {
        const target = this.get_node(target_bid);
        const target_win = this.get_window(target.wbid);

        const source_subtree = this.get_subtree(bid);
        const target_subtree = this.get_subtree(target.bid);
        const lastDescendantId = target_subtree[target_subtree.length - 1]!;
        const lastDescendantIndex = this.get_index(lastDescendantId);
        const targetIndex = this.get_index(target.bid);
        let currentIndex = target_win.tab_bids.indexOf(bid);
        currentIndex = currentIndex >= 0 ? currentIndex : Infinity;

        let newParentId: BruhId;
        let index: number;

        switch (position) {
            case 'above':
                newParentId = target.parent_bid;
                index = currentIndex > targetIndex ? targetIndex : targetIndex - source_subtree.length;
                break;
            case 'below':
                newParentId = target.parent_bid;
                index = currentIndex > lastDescendantIndex ? lastDescendantIndex + 1 : lastDescendantIndex + 1 - source_subtree.length;
                break;
            case 'inside':
            default:
                newParentId = target.bid;
                index = currentIndex > lastDescendantIndex ? lastDescendantIndex + 1 : lastDescendantIndex + 1 - source_subtree.length;
                break;
        }

        return { wbid: target_win.bid, parent_bid: newParentId, index };
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

    mark_window_closed(wbid: BruhId) {
        this.window_bids.delete(this.window_ids.get(wbid)!);
        this.window_ids.delete(wbid);
        let win = this.get_window(wbid);
        win.closed = true;
        win.is_archived_pristine = true;

        const storage = this.get_node_storage_data(win.bid);
        this.browser_restore_cache.set(storage.bid, storage);
        for (let bid of win.tab_bids) {
            const storage = this.get_node_storage_data(bid);
            this.browser_restore_cache.set(storage.bid, storage);
        }

        for (let tbid of win.tab_bids) {
            this.tab_bids.delete(this.tab_ids.get(tbid)!);
            this.tab_ids.delete(tbid);
            const node = this.get_tab(tbid);
            if (win.active !== node.bid) {
                node.discarded = true;
            }
        }

        if (win.tab_bids.length == 1) {
            let _ = this.remove_node(win.tab_bids[0]!);
            _ = this.remove_node(win.bid);
        }
    }

    remove_node(bid: BruhId) {
        const node = this.nodes.get(bid);
        if (!node) throw new Error(`node with bid: ${bid} does not exist`);
        if (node.type !== "window") {
            this.remove_tab_from_window(node.bid, node.wbid);
        }
        this.nodes.delete(bid);
        this.tab_name_cache.delete(bid);
        const tid = this.tab_ids.get(bid);
        if (tid !== undefined) this.tab_bids.delete(tid);
        this.tab_ids.delete(bid);
        const wid = this.window_ids.get(bid);
        if (wid !== undefined) this.window_bids.delete(wid);
        this.window_ids.delete(bid);
        return { type: 'node_removed', payload: { node, browser_id: tid === undefined ? wid : tid } } as Extract<BrowserEffect, { type: 'node_removed' }>;
    }

    remove_node_and_reparent_children(bid: BruhId) {
        const node = this.get_node(bid);

        const children = this.get_children_map().get(bid) || [];
        for (const childId of children) {
            this.get_node(childId).parent_bid = node.parent_bid;
        }
        return this.remove_node(node.bid);
    }

    reparent_node(bid: BruhId, new_parent_bid: BruhId, index?: number) {
        const node = this.get_node(bid);
        const parent = this.get_node(new_parent_bid);
        if (index === undefined) {
            index = this.get_target_index(node.bid, parent.bid, "inside").index;
        }
        const tbids_to_move = this.get_subtree(node.bid);

        node.parent_bid = new_parent_bid;
        for (let i = 0; i < tbids_to_move.length; i++) {
            const tbid = tbids_to_move[i]!;
            this.add_tab_to_window(tbid, parent.wbid, index + i);
        }

        return { type: 'tabs_moved', payload: { tbids: tbids_to_move, wbid: parent.wbid, index } } as Extract<BrowserEffect, { type: 'tabs_moved' }>;
    }

    reparent_children(bid: BruhId, new_parent_bid: BruhId, index?: number) {
        const node = this.get_node(bid);
        const parent = this.get_node(new_parent_bid);
        if (index === undefined) {
            index = this.get_target_index(node.bid, parent.bid, "inside").index;
        }

        const effect = { type: 'tabs_moved', payload: { tbids: [], wbid: parent.wbid, index } } as Extract<BrowserEffect, { type: 'tabs_moved' }>;
        const children = this.get_children_map().get(bid) || [];
        for (const childId of children) {
            const child_effect = this.reparent_node(childId, new_parent_bid, index);
            effect.payload.tbids.push(...child_effect.payload.tbids);
            index += child_effect.payload.tbids.length;
        }

        return effect;
    }

    create_new_tab(parent_bid: BruhId, options: { bid?: BruhId, url?: string, title?: string, hgid?: HierarchyGenerationId, index?: number, collapsed?: boolean }) {
        const bid = options.bid ?? this.bruhid++ as BruhId;
        const parent = this.get_node(parent_bid);
        const win = this.get_window(parent.wbid);
        const url = options.url ?? this.get_new_url();
        if (this.parse_group_url_id(url)) throw new Error(`App.create_new_tab cannot create 'group'`);
        const node: Node = {
            bid,
            url,
            parent_bid: parent.bid,
            wbid: parent.wbid,
            hgid: options.hgid ?? this.increment_hgid(),
            type: "tab",
            collapsed: options.collapsed ?? false,
            discarded: true,
            title: options.title ?? "New Tab",
            fav_icon_url: undefined,
        };
        this.nodes.set(bid, node);

        this.add_tab_to_window(bid, win.bid, options.index !== undefined ? options.index : win.tab_bids.length);
        return { type: 'tab_created', payload: { bid: bid, wbid: win.bid, index: this.get_index(bid) } } as Extract<BrowserEffect, { type: 'tab_created' }>;
    }

    create_new_group(parent_bid: BruhId, options: { bid?: BruhId, hgid?: HierarchyGenerationId, name?: GroupName, index?: number, collapsed?: boolean }) {
        const bid = options.bid ?? this.bruhid++ as BruhId;
        const parent = this.get_node(parent_bid);
        const win = this.get_window(parent.wbid);
        const url = this.get_group_url(bid);
        const node: Node = {
            bid,
            parent_bid: parent.bid,
            wbid: parent.wbid,
            hgid: options.hgid ?? this.increment_hgid(),
            type: "group",
            collapsed: options.collapsed ?? false,
            discarded: true,
            name: options.name ?? { name: this.generate_unique_group_name(), generation: bid, is_custom: false },
        };
        this.nodes.set(bid, node);

        this.add_tab_to_window(bid, win.bid, options.index !== undefined ? options.index : win.tab_bids.length);
        return { type: 'tab_created', payload: { bid: bid, wbid: win.bid, index: this.get_index(bid) } } as Extract<BrowserEffect, { type: 'tab_created' }>;
    }

    create_new_window(options: { bid?: BruhId, hgid?: HierarchyGenerationId, name?: GroupName, closed?: boolean }) {
        const bid = options.bid ?? this.bruhid++ as BruhId;
        const node: Node = {
            bid,
            parent_bid: 0 as BruhId & 0,
            wbid: bid,
            hgid: options.hgid ?? this.increment_hgid(),
            type: "window",
            collapsed: false,
            active: undefined,
            tab_bids: [],
            is_archived_pristine: false,
            closed: options.closed ?? false,
            name: options.name ?? { name: this.generate_unique_group_name(), generation: bid, is_custom: false },
        };
        this.nodes.set(bid, node);

        return { type: 'window_created', payload: { wbid: bid } } as Extract<BrowserEffect, { type: 'window_created' }>;
    }

    clone_subtree(root_bid: BruhId, parent_bid: BruhId | null, index: number) {
        const root_node = this.get_node(root_bid);

        let subtree = this.get_subtree(root_bid);
        const new_ids = new Map<BruhId, BruhId>();
        new_ids.set(root_node.parent_bid, parent_bid ?? 0 as BruhId);
        for (let bid of subtree) {
            new_ids.set(bid, this.bruhid++ as BruhId);
        }

        const hgid = this.increment_hgid();
        let new_window_effect;
        if (root_node.type == "window" && ((parent_bid ?? 0) == 0)) {
            new_window_effect = this.create_new_window({
                bid: new_ids.get(root_node.bid)!,
                name: { ...root_node.name },
                hgid,
            });
            if (root_node.active) {
                const new_win = this.get_window(new_window_effect.payload.wbid);
                new_win.active = new_ids.get(root_node.active)!;
            }
            subtree = subtree.slice(1);
        }

        const new_tab_effects = [];
        let i = index;
        for (let bid of subtree) {
            const node = this.get_node(bid);
            const pid = new_ids.get(node.parent_bid)!;

            if (node.type == "tab") {
                const new_node = this.create_new_tab(pid, {
                    bid: new_ids.get(bid)!,
                    url: node.url,
                    title: node.title,
                    index: i,
                    hgid,
                    collapsed: node.collapsed,
                });
                new_tab_effects.push(new_node);
            } else if (node.type == "group" || (node.type == "window" && pid !== 0)) {
                const new_node = this.create_new_group(pid, {
                    bid: new_ids.get(bid)!,
                    name: { ...node.name },
                    index: i,
                    hgid,
                    collapsed: node.collapsed,
                });
                new_tab_effects.push(new_node);
            } else throw new Error(`cannot handle 'window' here bid: ${bid}`);

            i += 1;
        }

        if (new_window_effect !== undefined) {
            return new_window_effect;
        } else {
            return { type: 'effects', payload: { effects: new_tab_effects } } as Extract<BrowserEffect, { type: "effects" }>;
        }
    }

    async save_state() {
        const nodes: Record<string, Node> = {};
        const node_storage: Record<string, NodeStorageData> = {};
        for (const [bid, node] of this.nodes.entries()) {
            const storage = this.get_node_storage_data(bid);
            node_storage[bid.toString()] = storage;
            nodes[bid.toString()] = node;
        }

        const cache: Record<string, NodeStorageData> = {};
        for (const [bid, storage] of this.browser_restore_cache.entries()) {
            cache[bid.toString()] = storage;
        }

        const state_to_save: StorageState = {
            state_version: this.extension_version,
            bruh_session_key: this.bruh_session_key,
            bruhid: this.bruhid,
            hgid: this.hierarchy_generation_id,
            nodes: nodes,
            node_storage_data: node_storage,
            browser_restore_cache: cache,
        };
        await browser.storage.local.set({ [this.storage_state_key]: state_to_save });
        await browser.storage.local.set({
            [this.storage_config_key]: {
                config_version: this.extension_version,
                config: this.config,
                user_config: this.user_config,
            } as ConfigStorage,
        });
    }

    async delete_state() {
        await browser.storage.local.remove(this.storage_state_key);
    }

    async load_config(): Promise<ConfigStorage> {
        const result = await browser.storage.local.get(this.storage_config_key);
        const config = result[this.storage_config_key] as ConfigStorage;
        if (!config) {
            return {
                config_version: this.extension_version,
                user_config: { ...this.user_config },
            };
        } else {
            return config;
        }
    }

    async load_state(key: string) {
        const result = await browser.storage.local.get(key);
        const state = result[key] as StorageState;
        if (!state) {
            const nodes: Map<BruhId, Node> = new Map();
            const node_storage: Map<BruhId, NodeStorageData> = new Map();
            for (const [bid, node] of this.nodes.entries()) {
                const storage = this.get_node_storage_data(bid);
                node_storage.set(bid, storage);
                nodes.set(bid, node);
            }
            const browser_restore_cache: Map<BruhId, NodeStorageData> = new Map();
            for (const [bid, storage] of this.browser_restore_cache.entries()) {
                browser_restore_cache.set(bid, storage);
            }
            return {
                state_version: this.extension_version,
                bruh_session_key: this.bruh_session_key,
                bruhid: this.bruhid,
                hierarchy_generation_id: this.hierarchy_generation_id,
                nodes: nodes,
                node_storage_data: node_storage,
                browser_restore_cache: this.browser_restore_cache,
            };
        }

        const cache: Map<BruhId, NodeStorageData> = new Map();
        for (const bstrid in state.browser_restore_cache) {
            const bid = Number(bstrid) as BruhId;
            cache.set(bid, state.browser_restore_cache[bstrid]!);
        }

        const nodes: Map<BruhId, Node> = new Map();
        for (const bstrid in state.nodes) {
            const bid = Number(bstrid) as BruhId;
            nodes.set(bid, state.nodes[bstrid]!);
        }

        const node_storage: Map<BruhId, NodeStorageData> = new Map();
        for (const bstrid in state.node_storage_data) {
            const bid = Number(bstrid) as BruhId;
            node_storage.set(bid, state.node_storage_data[bstrid]!);
        }


        return {
            state_version: state.state_version,
            bruh_session_key: state.bruh_session_key,
            bruhid: state.bruhid,
            hierarchy_generation_id: state.hgid,
            nodes: nodes,
            node_storage_data: node_storage,
            browser_restore_cache: cache,
        };
    }

    async write_session_pointer(bid: BruhId, id: TabId | WindowId, type: 'tab' | 'window'): Promise<void> {
        if (!this.config.available_apis.session_values) return;
        const data = { bid, bruh_session_key: this.bruh_session_key };
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

    async read_session_pointer(id: TabId | WindowId, type: 'tab' | 'window'): Promise<BruhId | undefined> {
        if (!this.config.available_apis.session_values) return;
        try {
            let data: any;
            if (type === 'tab') {
                data = await browser.sessions.getTabValue(id as TabId, this.session_pointer_key);
            } else {
                data = await browser.sessions.getWindowValue(id as WindowId, this.session_pointer_key);
            }
            if (this.bruh_session_key == data?.bruh_session_key) {
                return data?.bid;
            } else {
                return undefined;
            }
        } catch (e) {
            return undefined;
        }
    }

    async update_tab_info(btab: browser.Tabs.Tab) {
        const tbid = this.tab_bids.get(btab.id as TabId)!;
        const tab = this.get_tab(tbid);
        tab.discarded = btab.discarded ?? false;

        if (tab.type == "tab") {
            if (btab.title && !btab.discarded) {
                tab.title = btab.title;
            }
            if (btab.url && btab.url != "about:blank") {
                tab.url = btab.url;
            }
            if (btab.favIconUrl) {
                tab.fav_icon_url = btab.favIconUrl;
            }
        }

        if (btab.url == "about:blank") return;
        if (this.is_group_tab(btab)) {
            if (tab.type === "tab") {
                const name = this.tab_name_cache.get(tab.bid);
                this.tab_name_cache.delete(tab.bid);
                const _ = this.create_new_group(tab.parent_bid, {
                    bid: tab.bid,
                    hgid: tab.hgid,
                    name: name,
                    index: this.get_index(tab.bid),
                });
            }

            if (btab.url) {
                const url_bid = this.parse_group_url_id(btab.url);
                if (url_bid != tab.bid) {
                    await browser.tabs.update(btab.id!, { url: this.get_group_url(tab.bid) });
                }
            }
        } else {
            if (tab.type === "group") {
                this.tab_name_cache.set(tab.bid, tab.name);
                const _ = this.create_new_tab(tab.parent_bid, {
                    bid: tab.bid,
                    hgid: tab.hgid,
                    index: this.get_index(tab.bid),
                    title: btab.title,
                });
            }
        }
    }

    async register_bwindow(wid: WindowId, bid: BruhId) {
        this.window_ids.set(bid, wid);
        this.window_bids.set(wid, bid);
        await this.write_session_pointer(bid, wid, "window");
    }

    async register_btab(btab: browser.Tabs.Tab, bid: BruhId) {
        this.tab_ids.set(bid, btab.id! as TabId);
        this.tab_bids.set(btab.id! as TabId, bid);
        await this.write_session_pointer(bid, btab.id as TabId, "tab");
    }

    async restore_window(wid: WindowId, old_bid: BruhId, restore_cache: Map<BruhId, NodeStorageData>) {
        const cache = restore_cache.get(old_bid);
        restore_cache.delete(old_bid);
        if (!cache || cache.type !== "window") {
            throw new Error(`wrong cache for window bid: ${old_bid} tid: ${wid}`);
        }

        const node = this.nodes.get(old_bid) as Extract<Node, { type: "window" }> | undefined;
        const is_pristine = node?.is_archived_pristine ?? false;

        if (node && is_pristine) {
            node.closed = false;
            node.is_archived_pristine = true;
            node.tab_bids = [];
            await this.register_bwindow(wid, node.bid);
        } else {
            const new_win_effect = this.create_new_window({
                hgid: cache.hgid,
                name: cache.group_name,
            });
            const wbid = new_win_effect.payload.wbid;
            await this.register_bwindow(wid, wbid);

            // handled NOTE(1005) here. we don't create an entry here, if cache.tab_bids is empty
            if (cache.tab_bids.length > 0) {
                const new_ids = new Map();
                this.pre_allocated_bids_for_non_pristine_restore.set(wbid, { ids: new_ids, left_to_restore: new Set(cache.tab_bids) });
                new_ids.set(cache.bid, wbid);
                for (let tbid of cache.tab_bids) {
                    let new_tbid = this.bruhid++ as BruhId;
                    new_ids.set(tbid, new_tbid);
                }
            }
        }
    }

    async restore_tab(btab: browser.Tabs.Tab, old_bid: BruhId, restore_cache: Map<BruhId, NodeStorageData>) {
        const cache = restore_cache.get(old_bid);
        restore_cache.delete(old_bid);
        if (!cache || cache.type === "window") {
            throw new Error(`wrong cache for tab bid: ${old_bid} tid: ${btab.id}`);
        }

        const node = this.nodes.get(old_bid) as Exclude<Node, { type: "window" }> | undefined;
        const win = this.get_window(this.window_bids.get(btab.windowId as WindowId)!);
        const is_pristine = win.is_archived_pristine ?? false;

        if (node && is_pristine) {
            this.add_tab_to_window(node.bid, win.bid, cache.comes_after_bids.length);
            await this.register_btab(btab, node.bid);
            await this.update_tab_info(btab);
        } else {
            const non_pristine_restore = this.pre_allocated_bids_for_non_pristine_restore.get(win.bid);
            // NOTE: if non_pristine_restore is non-null, we have a complete window restore case - else it's a bunch of tabs being restored on a existing window
            if (non_pristine_restore) {
                non_pristine_restore.left_to_restore.delete(old_bid);
                // TODO: this will leak if
                //  - window closed
                //  - extension disabled
                //  - window restored
                //  - tabs edited
                //  - window closed
                //  - extension enabled
                //  - window restored (via browser)
                if (non_pristine_restore.left_to_restore.size == 0) {
                    this.pre_allocated_bids_for_non_pristine_restore.delete(win.bid);
                    win.is_archived_pristine = undefined;
                }
            }
            const new_ids = non_pristine_restore?.ids ?? new Map();
            // NOTE: we can safely reuse old_bid here, as the node is surely deleted in case of non-window restores
            const bid = new_ids.get(old_bid) ?? old_bid;

            if (cache.type == "group") {
                let _ = this.create_new_group(win.bid, {
                    bid,
                    hgid: cache.hgid,
                    name: cache.group_name,
                    collapsed: cache.collapsed,
                });
            } else {
                let _ = this.create_new_tab(win.bid, {
                    bid,
                    hgid: cache.hgid,
                    url: cache.url,
                    title: cache.title,
                    collapsed: cache.collapsed,
                });
                if (cache.cached_group_name) {
                    this.tab_name_cache.set(bid, cache.cached_group_name);
                }
            }
            await this.register_btab(btab, bid);
            await this.update_tab_info(btab);
            const tab = this.get_node(bid);

            // for parent reclamation, either the parent is not yet restored, or the parent is restored. (in no case can it just not be restored)
            const pid = new_ids.get(cache.parent_bid) ?? cache.parent_bid;
            if (this.nodes.has(pid) && win.tab_bids.indexOf(pid) >= 0) {
                tab.parent_bid = pid;
            }

            let index = win.tab_bids.length;
            for (let tbid of cache.comes_after_bids.toReversed()) {
                const i = win.tab_bids.indexOf(new_ids.get(tbid) ?? tbid);
                if (i != -1) {
                    index = i + 1;
                    break;
                }
            }
            this.add_tab_to_window(tab.bid, win.bid, index);

            // child reclamation
            for (const _child_id of cache.children_bids) {
                const child_id = new_ids.get(_child_id) ?? _child_id;
                if (this.nodes.has(child_id) && win.tab_bids.indexOf(child_id) >= 0) {
                    const child_node = this.get_tab(child_id);
                    // only restore if the archieve was done after this child was repositioned manually
                    if (child_node.hgid <= cache.cache_hgid) {
                        child_node.parent_bid = bid;
                    }
                }
            }
        }
    }

    async init_tree() {
        const config = await this.load_config();
        // TODO: some way to easily migrate using `config.config_version`
        this.user_config = config.user_config;

        let state = await this.load_state(this.storage_state_key);
        // TODO: some way to easily migrate using `state.state_version`
        if (this.user_config.dbg_reset_state_on_load) {
            state = await this.load_state("blah");
        }
        this.bruh_session_key = state.bruh_session_key;
        this.bruhid = state.bruhid;
        this.hierarchy_generation_id = state.hierarchy_generation_id;
        this.browser_restore_cache = state.browser_restore_cache;

        // need to take care of quite a few cases here
        // - this code runs as soon as the browser starts (like before user clicks "restore last session")
        //   (what happens to the "restore last session" window/tab)
        //   - no windows/tabs exist (maybe just the "restore last session" ones?)
        //   - so we can just mark all alive windows dead, save the browserrestorecache for safekeeping
        //     and let the restore mechanism take care of initializing the windows/tabs
        // - user disables/enables the extension.
        //   - windows/tabs already exist. so the browser.* calls below will have some windows/tabs
        //   - the state can be pretty stale here, a bunch of tabs that we think are alive might have been closed
        //     and a bunch of new tabs might be opened.
        //   - we can't do the "pristine" restores now.
        //     - what could work is to never try pristine restores.
        //     - we have the restore_cache-like state for all nodes, and we just do non-pristine restores, first from
        //       this special cache, if not there, from the browser_restore_cache.
        //     - but here, we need to somehow preserve the closed nodes (that are not restored)
        //       and keep the 'alive' nodes that went missing as closed
        //     - so i'll just do a smol trick here, and just
        //       - mark the missing windows closed
        //       - the 'alive' windows that are still alive will just lose/gain tabs
        //       - for some closed window that gets restored, we just pretend to restore it in a non-pristine way

        // plan:
        // - what do pre_allocated_bids_for_non_pristine_restore?
        //   if some tabs are missing, the entry in this map will persist, even though all tabs in the actual window are restored
        //   - huh?
        //     - clear cache.tab_bids to [] when restoring a window (to make sure pre_allocated_bids_for_non_pristine_restore is empty)
        //     - when 'restoring', pass the new_bid instead of the old one, and make sure the cache has the new bids everywhere?
        //   - huhh?
        //     - just restore like usual
        //     - clear pre_allocated_bids_for_non_pristine_restore to `new Map()`
        //     - set win.is_archived_pristine to undefined for those windows still in here.

        let bwins = await browser.windows.getAll({ populate: true, windowTypes: ['normal'] });

        // collect old ids
        const old_tbids = new Map();
        const old_wbids = new Map();
        for (const bwin of bwins) {
            const old_wbid = await this.read_session_pointer(bwin.id as WindowId, "window");
            if (old_wbid) {
                old_wbids.set(bwin.id as WindowId, old_wbid);
            }
            for (const btab of bwin.tabs!) {
                const old_tbid = await this.read_session_pointer(btab.id as TabId, "tab");
                if (old_tbid) {
                    old_tbids.set(btab.id as TabId, old_tbid);
                }
            }
        }

        const windows_to_preserve: Set<BruhId> = new Set();
        for (const [bid, node] of state.nodes.entries()) {
            if (node.type == "window") {
                windows_to_preserve.add(bid);
            }
        }

        const new_tabs_to_reparent_via_opener_id = new Set();
        // in this pass we try to restore only the windows that were open/closed+pristine, because the non-pristine closed windows
        // can only be restored by the extension
        for (const bwin of bwins) {
            const old_wbid = old_wbids.get(bwin.id as WindowId);
            if (!old_wbid) {
                // we create completely new windows here
                let new_win_effect = this.create_new_window({});
                await this.register_bwindow(bwin.id as WindowId, new_win_effect.payload.wbid);
            } else {
                const node = state.nodes.get(old_wbid) as Extract<Node, { type: "window" }>;
                if (!node) {
                    // windows that were restored via the browser restore api after the state for it was deleted
                    await this.restore_window(bwin.id as WindowId, old_wbid, this.browser_restore_cache);
                } else {
                    // windows that are open/closed, but still in state
                    if (node.is_archived_pristine) {
                        // we don't copy over anything that was 'pristine', and the window for it was restored
                        windows_to_preserve.delete(old_wbid);
                    }
                    if (!node.closed) {
                        // no copying over if node wasn't closed and was restored here.
                        windows_to_preserve.delete(old_wbid);
                    }
                    await this.restore_window(bwin.id as WindowId, old_wbid, state.node_storage_data);
                }
            }

            // TODO: MAYBE: there's probably a subtle bug somewhere in here,
            //    where a non-pristine/pristine restored tab is moved to a pristine/non-pristine restored window,
            //    and the restore logic explodes
            // NOTE tho:
            //  - we never can do a pristine restore here cuz this.nodes does not contain a window with .is_archived_pristine = true
            const win = this.get_window(this.window_bids.get(bwin.id as WindowId)!);
            for (const btab of bwin.tabs!) {
                const old_tbid = old_tbids.get(btab.id as TabId);
                let needs_new_tab = false;
                if (old_tbid) {
                    const node = state.nodes.get(old_tbid) as Exclude<Node, { type: "window" }>;
                    if (!node) {
                        if (this.browser_restore_cache.has(old_tbid)) {
                            await this.restore_tab(btab, old_tbid, this.browser_restore_cache);
                        } else {
                            needs_new_tab = true;
                        }
                    } else {
                        await this.restore_tab(btab, old_tbid, state.node_storage_data);
                    }
                } else {
                    needs_new_tab = true;
                }

                if (needs_new_tab) {
                    if (btab.openerTabId !== undefined) {
                        new_tabs_to_reparent_via_opener_id.add(btab.id!);
                    }
                    let tab;
                    if (this.is_group_tab(btab)) {
                        const new_tab_effect = this.create_new_group(win.bid, { index: btab.index });
                        tab = this.get_tab(new_tab_effect.payload.bid);
                    } else {
                        const new_tab_effect = this.create_new_tab(win.bid, {
                            url: btab.url,
                            title: btab.title ?? "Untitled",
                            index: btab.index,
                        });
                        tab = this.get_tab(new_tab_effect.payload.bid);
                    }
                    await this.register_btab(btab, tab.bid);
                    await this.update_tab_info(btab);
                }

                const tab = this.get_tab(this.tab_bids.get(btab.id as TabId)!);
                if (btab.active) {
                    win.active = tab.bid;
                }
            }
        }

        for (const [wbid, data] of this.pre_allocated_bids_for_non_pristine_restore.entries()) {
            this.pre_allocated_bids_for_non_pristine_restore.delete(wbid);
            const win = this.get_window(wbid);
            win.is_archived_pristine = undefined;
        }

        for (const tid of new_tabs_to_reparent_via_opener_id) {
            for (const bwin of bwins) {
                for (const btab of bwin.tabs!) {
                    if (btab.id !== tid) {
                        const bid = this.tab_bids.get(tid as TabId)!;
                        const node = this.get_node(bid);
                        if (!this.tab_bids.has(btab.openerTabId! as TabId)) {
                            break;
                        }
                        const pbid = this.tab_bids.get(btab.openerTabId as TabId)!;
                        this.reparent_node(node.bid, pbid);
                        break;
                    }
                }
            }
        }

        for (const wbid of windows_to_preserve) {
            const wnode = state.nodes.get(wbid)! as Extract<Node, { type: "window" }>;
            if (!wnode.closed) {
                wnode.closed = true;
                wnode.is_archived_pristine = true;
            }
            this.nodes.set(wnode.bid, wnode);
            for (const tbid of wnode.tab_bids) {
                const tnode = state.nodes.get(tbid)! as Exclude<Node, { type: "window" }>;
                this.nodes.set(tnode.bid, tnode);
            }
        }
    }

    async _process_event(event: StateManagerEvent, effects: utils.Deque<BrowserEffect>) {
        switch (event.type) {
            case 'tab_created': {
                const btab = event.payload.tab;
                if (btab.id === undefined || btab.windowId === undefined) return;
                if (!this.window_bids.has(btab.windowId as WindowId)) {
                    const old_wbid = await this.read_session_pointer(btab.windowId as WindowId, "window");
                    if (old_wbid && this.browser_restore_cache.has(old_wbid)) {
                        await this.restore_window(btab.windowId as WindowId, old_wbid, this.browser_restore_cache);
                    } else {
                        let new_win_effect = this.create_new_window({});
                        await this.register_bwindow(btab.windowId as WindowId, new_win_effect.payload.wbid);
                    }
                }
                const old_bid = await this.read_session_pointer(btab.id as TabId, "tab");
                if (old_bid && this.browser_restore_cache.has(old_bid)) {
                    await this.restore_tab(btab, old_bid, this.browser_restore_cache);
                    return;
                }
                if (this.tab_bids.has(btab.id as TabId)) {
                    this.update_tab_info(btab);
                    return;
                }
                const wbid = this.window_bids.get(btab.windowId as WindowId)!;
                const pid = (btab.openerTabId !== undefined ? this.tab_bids.get(btab.openerTabId as TabId) : undefined) ?? wbid;

                let effect;
                if (this.is_group_tab(btab)) {
                    effect = this.create_new_group(pid, { index: btab.index });
                } else {
                    effect = this.create_new_tab(pid, { index: btab.index, url: btab.url, title: btab.title });
                }
                const tbid = effect.payload.bid;
                await this.register_btab(btab, tbid);
                await this.update_tab_info(btab);
            } break;
            case 'tab_removed': {
                if (!this.tab_bids.has(event.payload.tid)) return;
                const tbid = this.tab_bids.get(event.payload.tid)!;
                // can't remove the tabs here that are moved to a closed window
                if (this.is_node_closed(tbid)) return;
                const tab = this.get_tab(tbid);
                if (event.payload.remove_info.isWindowClosing) {
                    if (!this.closing_window_tabs.has(tab.wbid)) {
                        this.closing_window_tabs.set(tab.wbid, new Set());
                    }
                    this.closing_window_tabs.get(tab.wbid)!.add(tab.bid);
                } else {
                    const tbid = this.tab_bids.get(event.payload.tid)!;
                    let _ = this.remove_node_and_reparent_children(tbid);
                }
            } break;
            case 'tab_updated': {
                if (!this.tab_bids.has(event.payload.tid)) return;
                await this.update_tab_info(event.payload.tab);
            } break;
            case 'tab_moved': {
                if (!this.tab_bids.has(event.payload.tid)) return;
                const tbid = this.tab_bids.get(event.payload.tid)!;
                const node = this.get_tab(tbid);
                const current_index = this.get_index(tbid);
                if (current_index == event.payload.move_info.toIndex) {
                    return;
                }
                if (current_index == event.payload.move_info.fromIndex) {
                    this.add_tab_to_window(tbid, node.wbid, event.payload.move_info.toIndex);
                }
            } break;
            case 'tab_attached': {
                if (!this.tab_bids.has(event.payload.tid)) return;
                const tbid = this.tab_bids.get(event.payload.tid)!;
                const node = this.get_tab(tbid);
                const wbid = this.window_bids.get(event.payload.attach_info.newWindowId as WindowId)!;
                const current_index = this.get_index(tbid);
                if (node.wbid == wbid && current_index == event.payload.attach_info.newPosition) return;
                this.add_tab_to_window(node.bid, wbid, event.payload.attach_info.newPosition);
            } break;
            case 'tab_detached': {
                // we just rely on 'tab_attached' to do the state changes for detach too
            } break;
            case 'tab_activated': {
                if (!this.tab_bids.has(event.payload.activated_info.tabId as TabId)) return;
                if (!this.window_bids.has(event.payload.activated_info.windowId as WindowId)) return;
                const wbid = this.window_bids.get(event.payload.activated_info.windowId as WindowId)!;
                const tbid = this.tab_bids.get(event.payload.activated_info.tabId as TabId)!;
                const win = this.get_window(wbid);
                win.active = tbid;
            } break;
            case 'window_created': {
                const bwin = event.payload.win;
                if (this.window_bids.has(bwin.id as WindowId)) return;

                const old_wbid = await this.read_session_pointer(bwin.id as WindowId, "window");
                if (old_wbid && this.browser_restore_cache.has(old_wbid)) {
                    await this.restore_window(bwin.id as WindowId, old_wbid, this.browser_restore_cache);
                } else {
                    let new_win_effect = this.create_new_window({});
                    await this.register_bwindow(bwin.id as WindowId, new_win_effect.payload.wbid);
                }
            } break;
            case 'window_removed': {
                if (!this.window_bids.has(event.payload.wid)) return;
                const wbid = this.window_bids.get(event.payload.wid)!;
                if (this.closing_window_tabs.has(wbid)) {
                    let tbids = this.closing_window_tabs.get(wbid)!;
                    this.closing_window_tabs.delete(wbid);

                    this.mark_window_closed(wbid);
                }
            } break;
            case 'window_focus_changed': {
                // nothing to do
            } break;
            case 'sessions_changed': {
                // TODO: completely broken. does not contain ids anywhere. not sure how to even link sessionId to tabs/windows
                // NOTE: there's no reasonable way to know what tab/window a session belongs to.
                //  - what is possible tho - is to sort of track the tabs/windows that *just* got closed and match them to newly created sessions.
                if (true) {
                    this.forget_tids.clear();
                    this.forget_wids.clear();
                }

                const sessions = await browser.sessions.getRecentlyClosed();
                for (let session of sessions) {
                    if (session.tab && session.tab.id !== undefined && session.tab.sessionId !== undefined && session.tab.windowId !== undefined) {
                        if (this.forget_tids.has(session.tab.id as TabId)) {
                            this.forget_tids.delete(session.tab.id as TabId);
                            await browser.sessions.forgetClosedTab(session.tab.windowId, session.tab.sessionId);
                        }
                    }
                    if (session.window && session.window.id !== undefined && session.window.sessionId !== undefined) {
                        if (this.forget_wids.has(session.window.id as WindowId)) {
                            this.forget_wids.delete(session.window.id as WindowId);
                            await browser.sessions.forgetClosedWindow(session.window.sessionId);
                        }
                    }
                }
            } break;
            case 'port_message': {
                const msg = event.payload.message;
                switch (msg.type) {
                    case 'get_state_for_window': {
                        const wid = msg.payload.wid;
                        if (!this.window_bids.has(wid)) {
                            return;
                        }
                        const wbid = this.window_bids.get(wid)!;
                        const state = this.build_ui_state_for_render(wbid);
                        this._post(event.payload.port, { type: 'state_update', payload: { state } });
                    } break;
                    case 'get_all_window_states': {
                        const states = this.nodes.values().filter(n => n.type == "window").map(n => this.build_ui_state_for_render(n.wbid));
                        this._post(event.payload.port, { type: 'all_states_update', payload: { states: [...states] } });
                    } break;
                    case 'get_state_for_group_view': {
                        const root = this.get_tab(msg.payload.bid);
                        const state = this.build_ui_state_for_render(root.wbid, root.bid);
                        this._post(event.payload.port, { type: 'state_update', payload: { state } });
                    } break;
                    case 'restore_window': {
                        const node = this.get_node(msg.payload.wbid);
                        if (node.type !== "window") throw new Error(`expected 'window' found '${node.type}' bid: ${node.bid}`);
                        if (!node.closed) throw new Error(`expected window to be closed for a restore operation bid: ${node.bid}`);
                        const effect = this.clone_subtree(node.bid, null, 0);
                        effects.push_back(effect);

                        // @ts-ignore
                        const wbid = effect.payload.wbid as BruhId;
                        const win = this.get_window(wbid);
                        win.is_archived_pristine = undefined;

                        const subtree = this.get_subtree(node.bid);
                        subtree.reverse();
                        for (const bid of subtree) {
                            let _ = this.remove_node(bid);
                        }
                    } break;
                    case 'handle_drop': {
                        const node = this.get_node(msg.payload.drag_data.draggedNodeId);
                        const target_node = this.get_node(msg.payload.target_bid);

                        const source_win = this.get_window(node.wbid);
                        const target_win = this.get_window(target_node.wbid);
                        if (source_win.closed) {
                            source_win.is_archived_pristine = false;
                        }
                        if (target_win.closed) {
                            target_win.is_archived_pristine = false;
                        }

                        const source_is_closed = source_win.closed;
                        const target_is_closed = target_win.closed;

                        let effect: BrowserEffect;
                        const target = this.get_target_index(node.bid, msg.payload.target_bid, msg.payload.action);

                        if (source_is_closed && !target_is_closed) {
                            // if window: create group, revive_tree at target, delete old tree
                            // if tab: revive_tree at target, delete old tree

                            // create new tabs for revived nodes/group
                            effect = this.clone_subtree(node.bid, target.parent_bid, target.index);

                            const subtree = this.get_subtree(node.bid);
                            subtree.reverse();
                            for (const bid of subtree) {
                                let _ = this.remove_node(bid);
                            }

                            effects.push_back(effect);
                        } else {
                            if (!source_is_closed && target_is_closed) {
                                const subtree = this.get_subtree(node.bid);
                                for (let bid of subtree) {
                                    const storage = this.get_node_storage_data(bid);
                                    this.browser_restore_cache.set(storage.bid, storage);
                                }
                            }

                            let wid;
                            let moved_tbids;
                            if (node.type == "window") {
                                const new_group_effect = this.create_new_group(target.parent_bid, { index: target.index, name: node.name });
                                const reparent_effect = this.reparent_children(node.bid, new_group_effect.payload.bid, target.index + 1);

                                // same as NOTE(1005)
                                if (!node.closed) {
                                    const storage = this.get_node_storage_data(node.bid);
                                    this.browser_restore_cache.set(storage.bid, storage);
                                }
                                const window_remove_effect = this.remove_node(node.bid);
                                wid = window_remove_effect.payload.browser_id as WindowId;

                                effect = {
                                    type: 'effects', payload: {
                                        effects: [
                                            new_group_effect,
                                            reparent_effect,
                                        ]
                                    }
                                };
                                moved_tbids = reparent_effect.payload.tbids;
                            } else {
                                effect = this.reparent_node(node.bid, target.parent_bid, target.index);
                                moved_tbids = effect.payload.tbids;
                            }

                            if (source_is_closed && target_is_closed) {
                                // if window: create group, reparent children, remove window
                                // if tab: reparent node
                            } else if (!source_is_closed && target_is_closed) {
                                // if window: create group, reparent children, remove window
                                // if tab: reparent node

                                // close tree
                                if (node.type == 'window') {
                                    if (wid === undefined) {
                                        throw new Error(`non-null wid expected here`);
                                    }
                                    this.forget_wids.add(wid);
                                    effects.push_back({ type: 'window_closed', payload: { wid: wid } });
                                } else {
                                    const moved_tids = moved_tbids.map(tbid => this.tab_ids.get(tbid)!);
                                    for (const tid of moved_tids) {
                                        this.forget_tids.add(tid);
                                    }
                                    effects.push_back({ type: 'tabs_closed', payload: { tids: moved_tids } });
                                }
                            } else if (!source_is_closed && !target_is_closed) {
                                // if window: create group, reparent children, remove window
                                // if tab: reparent node

                                // create browser tab for group, move tabs
                                effects.push_back(effect);
                            } else throw utils.exhausted(undefined as never);
                        }

                    } break;
                    case 'duplicate_tab': {
                        const node = this.get_node(msg.payload.bid);
                        if (node.type == "window") throw new Error(`expected 'tab' found 'window' bid: ${node.bid}`);

                        const win = this.get_window(node.wbid);
                        if (win.closed) {
                            win.is_archived_pristine = false;
                        }

                        let effect;
                        if (node.type == "group") {
                            effect = this.create_new_group(node.parent_bid, { index: this.get_index(node.bid) });
                        } else {
                            effect = this.create_new_tab(node.parent_bid, {
                                url: node.url,
                                title: node.title,
                                index: this.get_index(node.bid),
                            });
                        }

                        if (!this.is_node_closed(node.bid)) {
                            effects.push_back(effect);
                        }
                    } break;
                    case 'move_subtree_to_new_window': {
                        const node = this.get_node(msg.payload.bid);
                        if (node.type == "window") throw new Error(`expected 'tab' found 'window' bid: ${node.bid}`);
                        const win = this.get_window(node.wbid);
                        if (win.closed) {
                            win.is_archived_pristine = false;
                        }
                        const is_closed = win.closed;

                        const subtree = this.get_subtree(node.bid);

                        // this is very messy cuz moving a group to a new tab destroys the group tab
                        let effect;
                        if (node.type == "group") {
                            effect = this.create_new_window({ name: node.name, closed: is_closed });
                        } else {
                            effect = this.create_new_window({ closed: is_closed });
                        }
                        let _ = this.reparent_node(node.bid, effect.payload.wbid, 0);
                        if (node.type == "group") {
                            if (!is_closed) {
                                const storage = this.get_node_storage_data(node.bid);
                                this.browser_restore_cache.set(storage.bid, storage);
                            }
                            const remove_group_effect = this.remove_node_and_reparent_children(node.bid);
                            if (!is_closed) {
                                effects.push_back(remove_group_effect);
                            }
                        }

                        const old_win = this.get_window(node.wbid);
                        if (old_win.tab_bids.length == 0) {
                            // if we move all tabs from this window to a new window
                            // browser will just remove this window.
                            //
                            // on restoring such a window, it clones one of the tabs that got moved. (atleast on ff)
                            // so we just save the storage data for the window (with no tabs)
                            // NOTE(1005): this special case needs to be carefully handled in the browser restore handling code

                            if (!is_closed) {
                                const storage = this.get_node_storage_data(old_win.bid);
                                this.browser_restore_cache.set(storage.bid, storage);
                            }

                            let _ = this.remove_node(old_win.bid);
                        }

                        if (!is_closed) {
                            effects.push_back(effect);
                        }
                    } break;
                    case 'close_tabs': {
                        const node = this.get_node(msg.payload.bid);
                        if (node.type == "window" && !msg.payload.recursive) throw new Error(`expected 'tab' found 'window' bid: ${node.bid}`);
                        const win = this.get_window(node.wbid);
                        if (win.closed) {
                            win.is_archived_pristine = false;
                        }

                        if (msg.payload.recursive) {
                            const subtree = this.get_subtree(node.bid);
                            const closing_all_tabs = subtree.length == win.tab_bids.length;
                            let wid;
                            if (node.type == "window" || closing_all_tabs) {
                                wid = this.window_ids.get(win.bid)!;
                            }

                            if (!win.closed) {
                                for (let bid of subtree) {
                                    const storage = this.get_node_storage_data(bid);
                                    this.browser_restore_cache.set(storage.bid, storage);
                                }

                                if (closing_all_tabs) {
                                    // if we are closing all tabs in the window
                                    const storage = this.get_node_storage_data(win.bid);
                                    this.browser_restore_cache.set(storage.bid, storage);
                                }
                            }

                            let tids = [];
                            for (let bid of subtree) {
                                const tid = this.tab_ids.get(bid)!;
                                const effect = this.remove_node(bid);

                                if (effect.payload.node.type !== "window") {
                                    tids.push(tid);
                                }
                            }

                            if (closing_all_tabs) {
                                const _ = this.remove_node(win.bid);
                            }

                            if (!win.closed) {
                                if (node.type == "window" || closing_all_tabs) {
                                    if (wid === undefined) {
                                        throw new Error(`non-null wid expected here`);
                                    }
                                    // difference between 'remove tabs' on a window and 'close window' is that
                                    // this one deletes window, whereas 'close window' just closes them, but remembers them for restoration via extension gui
                                    effects.push_back({ type: "window_closed", payload: { wid: wid } });
                                } else {
                                    effects.push_back({ type: "tabs_closed", payload: { tids } });
                                }
                            }
                        } else {
                            if (!win.closed) {
                                const storage = this.get_node_storage_data(node.bid);
                                this.browser_restore_cache.set(storage.bid, storage);
                            }

                            const effect = this.remove_node_and_reparent_children(node.bid);;
                            if (!win.closed) {
                                effects.push_back(effect);
                            }
                        }
                    } break;
                    case 'close_window': {
                        // window is open (we can't close closed windows)

                        const win = this.get_window(msg.payload.wbid);
                        if (win.closed) return;
                        const wid = this.window_ids.get(win.bid)!;

                        this.mark_window_closed(win.bid);

                        effects.push_back({ type: 'window_closed', payload: { wid } });
                    } break;
                    case 'delete_window_state': {
                        const win = this.get_window(msg.payload.wbid);
                        if (!win.closed) throw new Error(`cannot delete state for open window with bid: ${win.bid}`);
                        const tbids = [...win.tab_bids];
                        let _;
                        for (let bid of tbids) {
                            _ = this.remove_node(bid);
                        }
                        _ = this.remove_node(win.bid);
                    } break;
                    case 'reload_tree': {
                        const root = this.get_node(msg.payload.bid);
                        const win = this.get_window(root.wbid);
                        if (win.closed) return;
                        const bids = this.get_subtree(root.bid);

                        let tbids = [];
                        for (let bid of bids) {
                            const node = this.get_node(bid);
                            if (node.type == "window") {
                                continue;
                            }

                            node.discarded = false;
                            tbids.push(node.bid);
                        }
                        if (tbids.length > 0) {
                            effects.push_back({ type: 'tabs_reloaded', payload: { tbids, wbid: win.bid } });
                        }
                    } break;
                    case 'unload_tabs': {
                        const node = this.get_node(msg.payload.bid);
                        const win = this.get_window(node.wbid);
                        if (win.closed) return;
                        const bids = msg.payload.recursive ? this.get_subtree(msg.payload.bid) : [node.bid];

                        let tbids = [];
                        for (let bid of bids) {
                            const node = this.get_node(bid);
                            if (node.type == "window") {
                                continue;
                            }

                            if (win.active !== node.bid) {
                                node.discarded = true;
                                tbids.push(node.bid);
                            }
                        }

                        if (tbids.length > 0) {
                            effects.push_back({ type: 'tabs_discarded', payload: { tbids, wbid: win.bid } });
                        }
                    } break;
                    case 'focus_tab': {
                        const node = this.get_tab(msg.payload.bid);
                        const win = this.get_window(node.wbid);
                        if (win.closed) return;
                        win.active = node.bid;

                        effects.push_back({ type: 'tab_focused', payload: { bid: node.bid } });
                    } break;
                    case 'create_group': {
                        const parent_bid = msg.payload.parent_bid;
                        const parent = this.get_node(parent_bid);
                        const win = this.get_window(parent.wbid);
                        if (win.closed) {
                            win.is_archived_pristine = false;
                        }

                        const bid = this.bruhid++ as BruhId;
                        const target = this.get_target_index(bid, parent.bid, "inside");
                        const effect = this.create_new_group(target.parent_bid, { bid: bid, index: target.index });
                        effects.push_back(effect);
                    } break;
                    case 'create_tab': {
                        const url = msg.payload.url;
                        const parent_bid = msg.payload.parent_bid;
                        const parent = this.get_node(parent_bid);
                        const win = this.get_window(parent.wbid);
                        if (win.closed) {
                            win.is_archived_pristine = false;
                        }

                        const bid = this.bruhid++ as BruhId;
                        const target = this.get_target_index(bid, parent.bid, msg.payload.action);
                        let create_effect;
                        if (!!url && this.parse_group_url_id(url) !== null) {
                            create_effect = this.create_new_group(parent.bid, { bid: bid, index: target.index });
                        } else {
                            create_effect = this.create_new_tab(parent.bid, { bid: bid, url: url, index: target.index });
                        }

                        effects.push_back(create_effect);
                    } break;
                    case 'toggle_collapse': {
                        const node = this.get_node(msg.payload.bid);
                        node.collapsed = !node.collapsed;
                    } break;
                    case 'flatten_tree': {
                        const node = this.get_node(msg.payload.bid);
                        const win = this.get_window(node.wbid);
                        if (win.closed) {
                            win.is_archived_pristine = false;
                        }

                        this.flatten_node(node.bid, msg.payload.recursive, this.increment_hgid());
                    } break;
                    case 'rename_node': {
                        const node = this.get_node(msg.payload.bid);
                        if (node.type == "tab") {
                            throw new Error(`'tab' nodes cannot be renamed`);
                        }

                        const win = this.get_window(node.wbid);
                        if (win.closed) {
                            win.is_archived_pristine = false;
                        }

                        node.name.name = msg.payload.new_name;
                        node.name.is_custom = true;
                    } break;
                    default:
                        throw utils.exhausted(msg);
                }
            } break;
            default:
                throw utils.exhausted(event);
        }
    }

    async _process_effect(effects: utils.Deque<BrowserEffect>, effect: BrowserEffect) {
        switch (effect.type) {
            case 'effects': {
                for (let i = effect.payload.effects.length; i > 0; i--) {
                    const e = effect.payload.effects[i - 1]!;
                    effects.push_front(e);
                }
            } break;
            case 'node_removed': {
                if (effect.payload.node.type == "window") {
                    await browser.windows.remove(effect.payload.browser_id);
                } else {
                    await browser.tabs.remove(effect.payload.browser_id);
                }
            } break;
            case 'tab_created': {
                const node = this.get_tab(effect.payload.bid);
                const win = this.get_window(node.wbid);
                const wid = this.window_ids.get(node.wbid);
                const index = this.get_index(node.bid);
                const active = win.active == node.wbid;

                let url;
                let title;
                if (node.type == 'tab') {
                    url = node.url;
                    title = node.title;
                } else {
                    url = this.get_group_url(node.bid);
                    title = node.name.name;
                }

                // title can only be supplied if tab is discarded at init
                if (active) {
                    title = undefined;
                }
                let btab = await browser.tabs.create({ windowId: wid, url, index, discarded: !active, active });
                await this.register_btab(btab, node.bid);
            } break;
            case 'tab_focused': {
                const node = this.get_tab(effect.payload.bid);
                const tid = this.tab_ids.get(node.bid);
                if (tid === undefined) throw new Error(`non null tid expected for '${effect.type}'`);
                let _ = await browser.tabs.update(tid, { active: true });
            } break;
            case 'tabs_moved': {
                const wid = this.window_ids.get(effect.payload.wbid);
                if (wid === undefined) throw new Error(`non null wid expected for ${effect.type}`)
                let _ = await browser.tabs.move(effect.payload.tbids.map(tbid => this.tab_ids.get(tbid)!), { windowId: wid, index: effect.payload.index });
            } break;
            case 'tabs_discarded': {
                const tids = [];
                for (const tbid of effect.payload.tbids) {
                    let tid = this.tab_ids.get(tbid);
                    if (tid === undefined) {
                        throw new Error(`non null tid expected for ${effect.type}`);
                    }
                    tids.push(tid);
                }
                let _ = await browser.tabs.discard(tids as TabId[]);
            } break;
            case 'tabs_reloaded': {
                for (const tbid of effect.payload.tbids) {
                    let tid = this.tab_ids.get(tbid);
                    if (tid === undefined) {
                        throw new Error(`non null tid expected for ${effect.type}`);
                    }

                    let _ = await browser.tabs.reload(tid, {});
                }
            } break;
            case 'tabs_closed': {
                await browser.tabs.remove(effect.payload.tids);
            } break;
            case 'window_created': {
                const win = this.get_window(effect.payload.wbid);
                let tbids = [...win.tab_bids];
                const indexof_active = tbids.indexOf(win.active ?? tbids[0]!);
                if (indexof_active < 0) throw new Error(`win.active does not exist in win.tab_bids for wbid: ${win.bid}`);
                const active = tbids.splice(indexof_active, 1)[0]!;

                let bwin;
                if (this.tab_ids.has(active)) {
                    bwin = await browser.windows.create({
                        tabId: this.tab_ids.get(active)!,
                    });
                } else {
                    bwin = await browser.windows.create({
                        url: this.get_node_url(active),
                    });
                    const btab = bwin.tabs![0]!;
                    await this.register_btab(btab, active);
                }
                await this.register_bwindow(bwin.id as WindowId, win.bid);

                let i = 0;
                for (const tbid of tbids) {
                    if (indexof_active == i) {
                        i += 1;
                    }
                    if (this.tab_ids.has(tbid)) {
                        let _ = await browser.tabs.move(this.tab_ids.get(tbid)!, { windowId: bwin.id!, index: i });
                    } else {
                        let btab = await browser.tabs.create({
                            windowId: bwin.id!,
                            url: this.get_node_url(tbid),
                            index: i,
                            discarded: true,
                            active: false,
                            title: this.get_node_name(tbid),
                        });
                        await this.register_btab(btab, tbid);
                    }
                    i += 1;
                }
            } break;
            case 'window_closed': {
                await browser.windows.remove(effect.payload.wid);
            } break;
            default:
                throw utils.exhausted(effect);
        }
    }
};

async function main() {
    let app = App.init();
    // @ts-ignore
    globalThis.app = app;

    app.attach_listeners();
    await app.init_tree();
    await app.process_events();
}

main()
