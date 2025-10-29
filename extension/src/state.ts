import browser from 'webextension-polyfill';
import type {
    StateEvent,
    StateAction,
    Node,
    TabId,
    HierarchyGenerationId,
    WindowId,
    BruhId,
    NodeStorageData,
    GroupName,
    TabData,
    WindowData,
    DropAction,
    AppEffect,
    StateStorage,
    SerializableState,
    BruhExport,
    SideberryExport,
    Config,
    UserConfig,
    Snapshot,
    ConfigStorage,
    StateEffect,
    ClonableState,
} from './types';
import * as utils from './utils';

export class State {
    rng: utils.Xoshiro256;
    config: Config;
    user_config: UserConfig;
    extension_version: string;
    bruh_session_key: string;

    bruhid: BruhId = 1 as BruhId;
    hierarchy_generation_id: HierarchyGenerationId = 1 as HierarchyGenerationId;

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

    snapshots: Snapshot[] = [];

    window_ids: Map<BruhId, WindowId> = new Map();
    tab_ids: Map<BruhId, TabId> = new Map();
    window_bids: Map<WindowId, BruhId> = new Map();
    tab_bids: Map<TabId, BruhId> = new Map();

    forget_tids: Set<TabId> = new Set();
    forget_wids: Set<WindowId> = new Set();

    private adjectives = ["Agile", "Azure", "Blue", "Bold", "Bright", "Calm", "Clever", "Cool", "Crimson", "Eager", "Emerald", "Golden", "Green", "Happy", "Jade", "Jolly", "Keen", "Light", "Lime", "Lucky", "Magic", "Mega", "Navy", "New", "Noble", "Olive", "Orange", "Ornate", "Proud", "Purple", "Quick", "Quiet", "Red", "Regal", "Rose", "Ruby", "Silver", "Sky", "Solar", "Teal", "Topaz", "Urban", "Vivid", "Warm", "White", "Wise", "Yellow", "Zen"];
    private nouns = ["Alpaca", "Ant", "Ape", "Bear", "Bee", "Bird", "Bison", "Cat", "Clam", "Cobra", "Crane", "Crow", "Deer", "Dog", "Dove", "Duck", "Eagle", "Elk", "Emu", "Finch", "Fish", "Fly", "Fox", "Frog", "Goat", "Goose", "Hawk", "Hen", "Heron", "Ibex", "Ibis", "Jay", "Kite", "Kiwi", "Lark", "Lion", "Llama", "Mole", "Moth", "Mouse", "Mule", "Newt", "Owl", "Panda", "Puma", "Quail", "Rabbit", "Ram", "Rat", "Raven", "Rhino", "Rook", "Seal", "Shark", "Skunk", "Sloth", "Snail", "Stork", "Swan", "Tiger", "Toad", "Tuna", "Viper", "Wasp", "Wolf", "Wren", "Yak", "Zebra"];

    constructor(version: string) {
        this.rng = utils.Xoshiro256.from_bigint(BigInt(Math.floor(Math.random() * (1 << 30))));
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
        this.bruh_session_key = this.rng.nextU32().toString();
    }

    is_group_tab(_url: string | undefined): boolean {
        if (!_url) return false;
        try {
            const url = new URL(_url);
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
            const adj = this.adjectives[Math.floor(this.rng.nextFloat() * this.adjectives.length)];
            const noun = this.nouns[Math.floor(this.rng.nextFloat() * this.nouns.length)];
            name = `${adj} ${noun}`;
        } while (existingNames.has(name));

        return name;
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

    // get_children_map(): Map<BruhId, BruhId[]> {
    //     const index_map = new Map<BruhId, number>();
    //     const map = new Map<BruhId, BruhId[]>();
    //     for (const [_, node] of this.nodes) {
    //         if (!map.has(node.parent_bid)) {
    //             map.set(node.parent_bid, []);
    //         }
    //         map.get(node.parent_bid)!.push(node.bid);
    //         index_map.set(node.bid, this.get_index(node.bid));
    //     }
    //     for (const [_, nodes] of map) {
    //         nodes.sort((a, b) => index_map.get(a)! - index_map.get(b)!);
    //     }
    //     return map;
    // }

    get_subtree(bid: BruhId): BruhId[] {
        if (!this.nodes.has(bid)) return [bid];
        const node = this.get_node(bid);
        if (node.type == "window") {
            return [bid, ...node.tab_bids];
        }

        const win = this.get_window(node.wbid);
        const index = this.get_index(node.bid) + 1;

        const maybe_parents = new Set();
        maybe_parents.add(node.bid);
        const subtree = [bid];
        for (let i = index; i < win.tab_bids.length; i++) {
            const tbid = win.tab_bids[i]!;
            const tab = this.get_tab(tbid);
            if (maybe_parents.has(tab.parent_bid)) {
                subtree.push(tbid);
                maybe_parents.add(tbid);
            } else {
                break;
            }
        }
        return subtree;
    }

    get_immediate_children(bid: BruhId): BruhId[] {
        if (!this.nodes.has(bid)) return [];
        const node = this.get_node(bid);
        const win = this.get_window(node.wbid);
        const index = this.get_index(node.bid) + 1;

        const maybe_parents = new Set();
        maybe_parents.add(node.bid);
        const children = [];
        for (let i = index; i < win.tab_bids.length; i++) {
            const tbid = win.tab_bids[i]!;
            const tab = this.get_tab(tbid);
            if (maybe_parents.has(tab.parent_bid)) {
                maybe_parents.add(tbid);
                if (tab.parent_bid == bid) {
                    children.push(tbid);
                }
            } else {
                break;
            }
        }
        return children;
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
        const childrenIds = this.get_immediate_children(bid);
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
        const nodesToMove = recursive ? this.get_subtree(bid).slice(1) : this.get_immediate_children(bid);
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
    }

    register_bwindow(wid: WindowId, bid: BruhId) {
        this.window_ids.set(bid, wid);
        this.window_bids.set(wid, bid);
        return { type: "write_window_session", payload: { wid, bid } } as Extract<AppEffect, { type: 'write_window_session' }>;
    }

    register_btab(tid: TabId, bid: BruhId) {
        this.tab_ids.set(bid, tid);
        this.tab_bids.set(tid, bid);
        return { type: "write_tab_session", payload: { tid, bid } } as Extract<AppEffect, { type: 'write_tab_session' }>;
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
        return { type: 'node_removed', payload: { node, browser_id: tid === undefined ? wid : tid } } as Extract<AppEffect, { type: 'node_removed' }>;
    }

    remove_node_and_reparent_children(bid: BruhId) {
        const node = this.get_node(bid);

        const children = this.get_immediate_children(bid);
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

        return { type: 'tabs_moved', payload: { tbids: tbids_to_move, wbid: parent.wbid, index } } as Extract<AppEffect, { type: 'tabs_moved' }>;
    }

    reparent_children(bid: BruhId, new_parent_bid: BruhId, index?: number) {
        const node = this.get_node(bid);
        const parent = this.get_node(new_parent_bid);
        if (index === undefined) {
            index = this.get_target_index(node.bid, parent.bid, "inside").index;
        }

        const effect = { type: 'tabs_moved', payload: { tbids: [], wbid: parent.wbid, index } } as Extract<AppEffect, { type: 'tabs_moved' }>;
        const children = this.get_immediate_children(bid);
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
        let url = options.url ?? this.get_new_url();
        if (this.parse_group_url_id(url)) throw new Error(`App.create_new_tab cannot create 'group'`);
        if (this.is_url_funny(url)) {
            url = this.get_new_url();
        }
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
        return { type: 'tab_created', payload: { bid: bid, wbid: win.bid, index: this.get_index(bid) } } as Extract<AppEffect, { type: 'tab_created' }>;
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
        return { type: 'tab_created', payload: { bid: bid, wbid: win.bid, index: this.get_index(bid) } } as Extract<AppEffect, { type: 'tab_created' }>;
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

        return { type: 'window_created', payload: { wbid: bid } } as Extract<AppEffect, { type: 'window_created' }>;
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
            return { type: 'effects', payload: { effects: new_tab_effects } } as Extract<AppEffect, { type: "effects" }>;
        }
    }

    get_export_data(for_download: boolean = false): BruhExport {
        const bruhExport: BruhExport = {
            name: "Tabruh Export",
            timestamp: new Date().toISOString(),
            windows: [],
        };

        const windowNodes = Array.from(this.nodes.values()).filter(n => n.type === 'window') as WindowData[];

        for (const win of windowNodes) {
            const bid_to_index = new Map<BruhId, number>();
            for (let i = 0; i < win.tab_bids.length; i++) {
                bid_to_index.set(win.tab_bids[i]!, i);
            }

            const exportWindow: BruhExport['windows'][0] = {
                name: win.name.name,
                tabs: [],
            };

            for (const tbid of win.tab_bids) {
                const node = this.get_tab(tbid);
                const parent_index = node.parent_bid === win.bid ? null : bid_to_index.get(node.parent_bid) ?? null;

                const url = this.get_node_url(node.bid);
                const title = this.get_node_name(node.bid);

                const tabExport: BruhExport['windows'][0]['tabs'][0] = {
                    url,
                    title,
                    parent_index,
                };

                if (!for_download) {
                    tabExport.collapsed = node.collapsed;
                }

                exportWindow.tabs.push(tabExport);
            }
            bruhExport.windows.push(exportWindow);
        }
        return bruhExport;
    }

    load_export_data(data: BruhExport) {
        for (const winData of data.windows) {
            const effect = this.create_new_window({
                name: {
                    name: winData.name ?? this.generate_unique_group_name(),
                    generation: 0,
                    is_custom: !!winData.name
                },
                closed: true
            });
            const wbid = effect.payload.wbid;

            const new_bids: BruhId[] = [];

            for (let i = 0; i < winData.tabs.length; i++) {
                const tabData = winData.tabs[i]!;

                const parent_bid = tabData.parent_index === null ? wbid : new_bids[tabData.parent_index]!;

                let new_tab_effect;
                if (this.parse_group_url_id(tabData.url)) {
                    new_tab_effect = this.create_new_group(parent_bid, {
                        index: i,
                        name: { name: tabData.title, generation: 0, is_custom: true },
                    });
                } else {
                    new_tab_effect = this.create_new_tab(parent_bid, { url: tabData.url, title: tabData.title, index: i });
                }
                new_bids.push(new_tab_effect.payload.bid);
            }
        }
    }

    static convert_sideberry_export_to_bruh(data: SideberryExport): BruhExport {
        const bruhExport: BruhExport = {
            timestamp: new Date().toISOString(),
            windows: [],
        };

        if (!data.windows) return bruhExport;

        for (const win of data.windows) {
            const panelTabs = win.panels.flatMap(p => p.tabs);
            if (panelTabs.length === 0) continue;

            const windowName = win.panels[0]?.name ?? `Imported Window ${win.id}`;

            const bruhWindow: BruhExport['windows'][0] = {
                name: windowName,
                tabs: [],
            };

            const parentIndexStack: number[] = [];

            for (let i = 0; i < panelTabs.length; i++) {
                const tab = panelTabs[i]!;
                const currentLevel = tab.lvl ?? 0;

                while (parentIndexStack.length > currentLevel) {
                    parentIndexStack.pop();
                }

                const parent_index = currentLevel > 0 && parentIndexStack.length > 0
                    ? parentIndexStack[parentIndexStack.length - 1]!
                    : null;

                bruhWindow.tabs.push({
                    url: tab.url,
                    title: tab.title,
                    parent_index: parent_index,
                });

                parentIndexStack[currentLevel] = i;
            }
            bruhExport.windows.push(bruhWindow);
        }
        return bruhExport;
    }

    create_snapshot(name: string): void {
        const snapshot: Snapshot = {
            id: this.rng.nextUUID(),
            name,
            timestamp: new Date().toISOString(),
            data: this.get_export_data(),
        };
        this.snapshots.push(snapshot);
    }

    delete_snapshot(id: string): void {
        this.snapshots = this.snapshots.filter(s => s.id !== id);
    }

    restore_snapshot_window(id: string, window_index: number): void {
        const snapshot = this.snapshots.find(s => s.id === id);
        if (!snapshot) return;

        const windowData = snapshot.data.windows[window_index];
        if (!windowData) return;

        const singleWindowExport: BruhExport = {
            ...snapshot.data,
            windows: [windowData],
        };

        this.load_export_data(singleWindowExport);
    }

    restore_snapshot_subtree(id: string, window_index: number, tab_index: number): void {
        const snapshot = this.snapshots.find(s => s.id === id);
        if (!snapshot) return;

        const windowData = snapshot.data.windows[window_index];
        if (!windowData) return;

        const subtreeIndices = new Set<number>();
        const queue = [tab_index];
        while (queue.length > 0) {
            const currentIndex = queue.shift()!;
            if (subtreeIndices.has(currentIndex)) continue;
            subtreeIndices.add(currentIndex);

            for (let i = 0; i < windowData.tabs.length; i++) {
                if (windowData.tabs[i]!.parent_index === currentIndex) {
                    queue.push(i);
                }
            }
        }

        const sortedSubtreeIndices = Array.from(subtreeIndices).sort((a, b) => a - b);
        const oldIndexToNewIndex = new Map<number, number>();
        sortedSubtreeIndices.forEach((oldIndex, newIndex) => {
            oldIndexToNewIndex.set(oldIndex, newIndex);
        });

        const subtreeTabs = sortedSubtreeIndices.map(oldIndex => {
            const tab = { ...windowData.tabs[oldIndex]! };
            if (tab.parent_index !== null && oldIndexToNewIndex.has(tab.parent_index)) {
                tab.parent_index = oldIndexToNewIndex.get(tab.parent_index)!;
            } else {
                tab.parent_index = null; // Root of the subtree becomes root of the new window
            }
            return tab;
        });

        const rootTabName = windowData.tabs[tab_index]?.title ?? 'Restored Subtree';
        const newWindowName = `${windowData.name} - ${rootTabName}`;

        const subtreeExport: BruhExport = {
            ...snapshot.data,
            windows: [{
                name: newWindowName,
                tabs: subtreeTabs,
            }],
        };

        this.load_export_data(subtreeExport);
    }

    _get_snapshot_subtree_tabs(windowData: BruhExport['windows'][number], root_tab_index?: number): BruhExport['windows'][0]['tabs'] {
        const tabsToRestore: BruhExport['windows'][0]['tabs'] = [];

        if (root_tab_index === undefined) { // Whole window
            return windowData.tabs;
        }

        const subtreeIndices = new Set<number>();
        const queue = [root_tab_index];
        while (queue.length > 0) {
            const currentIndex = queue.shift()!;
            if (subtreeIndices.has(currentIndex)) continue;
            subtreeIndices.add(currentIndex);
            for (let i = 0; i < windowData.tabs.length; i++) {
                if (windowData.tabs[i]!.parent_index === currentIndex) queue.push(i);
            }
        }

        const sortedSubtreeIndices = Array.from(subtreeIndices).sort((a, b) => a - b);
        const oldIndexToNewIndex = new Map<number, number>();
        sortedSubtreeIndices.forEach((oldIndex, newIndex) => oldIndexToNewIndex.set(oldIndex, newIndex));

        return sortedSubtreeIndices.map(oldIndex => {
            const tab = { ...windowData.tabs[oldIndex]! };
            tab.parent_index = tab.parent_index === null || !oldIndexToNewIndex.has(tab.parent_index)
                ? null
                : oldIndexToNewIndex.get(tab.parent_index)!;
            return tab;
        });
    }

    load_tabs_into_parent(tabs: BruhExport['windows'][0]['tabs'], parent_bid: BruhId, index?: number) {
        const parent_node = this.get_node(parent_bid);
        const win = this.get_window(parent_node.wbid);
        if (win.closed) {
            win.is_archived_pristine = false;
        }

        const effects = [];
        const new_bids: BruhId[] = [];
        for (let i = 0; i < tabs.length; i++) {
            const tabData = tabs[i]!;
            const new_parent_bid = tabData.parent_index === null ? parent_bid : new_bids[tabData.parent_index]!;

            const insertionIndex = (index === undefined) ? undefined : index + i;

            if (new_parent_bid === undefined) {
                throw new Error(`Error importing subtree: invalid parent_index ${tabData.parent_index}`);
            }

            let new_tab_effect;
            if (this.parse_group_url_id(tabData.url)) {
                new_tab_effect = this.create_new_group(new_parent_bid, {
                    name: { name: tabData.title, generation: 0, is_custom: true },
                    index: insertionIndex,
                });
            } else {
                new_tab_effect = this.create_new_tab(new_parent_bid, {
                    url: tabData.url,
                    title: tabData.title,
                    index: insertionIndex,
                });
            }
            effects.push(new_tab_effect);
            new_bids.push(new_tab_effect.payload.bid);
        }

        if (!win.closed) {
            // If the target window is open, we need to create the browser tabs for the newly added nodes
            const effect = { type: 'effects', payload: { effects } } as Extract<AppEffect, { type: 'effects' }>;
            return effect;
        }
        return null;
    }

    serialize_state() {
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

        const state_to_save: StateStorage = {
            rng_state: this.rng.s,
            state_version: this.extension_version,
            bruh_session_key: this.bruh_session_key,
            bruhid: this.bruhid,
            hgid: this.hierarchy_generation_id,
            nodes: nodes,
            node_storage_data: node_storage,
            browser_restore_cache: cache,
            snapshots: this.snapshots,
        };

        const config: ConfigStorage = {
            config_version: this.extension_version,
            user_config: this.user_config,
        };

        const state: SerializableState = { state: state_to_save, config };
        return structuredClone(state);
    }

    clonable_state(): ClonableState {
        return structuredClone({
            config: this.config,
            user_config: this.user_config,
            rng_state: this.rng.s,
            extension_version: this.extension_version,
            bruh_session_key: this.bruh_session_key,
            bruhid: this.bruhid,
            hgid: this.hierarchy_generation_id,
            nodes: Object.fromEntries([...this.nodes.entries()].map(([k, v]) => [String(k), v])),
            browser_restore_cache: Object.fromEntries([...this.browser_restore_cache.entries()].map(([k, v]) => [String(k), v])),
            snapshots: this.snapshots,
            tab_name_cache: Object.fromEntries([...this.tab_name_cache.entries()].map(([k, v]) => [String(k), v])),
            closing_window_tabs: Object.fromEntries([...this.closing_window_tabs.entries()].map(([k, v]) => [String(k), [...v.values()]])),
            pre_allocated_bids_for_non_pristine_restore: Object.fromEntries([...this.pre_allocated_bids_for_non_pristine_restore.entries()].map(
                ([k, v]) => [String(k), {
                    ids: Object.fromEntries([...v.ids.entries()].map(([k, v]) => [String(k), v])),
                    left_to_restore: [...v.left_to_restore.values()]
                }]
            )),

            window_ids: Object.fromEntries([...this.window_ids.entries()].map(([k, v]) => [String(k), v])),
            tab_ids: Object.fromEntries([...this.tab_ids.entries()].map(([k, v]) => [String(k), v])),
            window_bids: Object.fromEntries([...this.window_bids.entries()].map(([k, v]) => [String(k), v])),
            tab_bids: Object.fromEntries([...this.tab_bids.entries()].map(([k, v]) => [String(k), v])),

            forget_tids: [...this.forget_tids.values()],
            forget_wids: [...this.forget_wids.values()],
        });
    }

    static from_clonable_state(state: ClonableState): State {
        const self = new State("huh");
        self.config = state.config;
        self.user_config = state.user_config;
        self.rng.s = state.rng_state;
        self.extension_version = state.extension_version;
        self.bruh_session_key = state.bruh_session_key;
        self.bruhid = state.bruhid;
        self.hierarchy_generation_id = state.hgid;
        self.nodes = new Map(Object.entries(state.nodes).map(([k, v]) => [Number(k) as BruhId, v]));
        self.browser_restore_cache = new Map(Object.entries(state.browser_restore_cache).map(([k, v]) => [Number(k) as BruhId, v]));
        self.snapshots = state.snapshots;
        self.tab_name_cache = new Map(Object.entries(state.tab_name_cache).map(([k, v]) => [Number(k) as BruhId, v]));
        self.closing_window_tabs = new Map(Object.entries(state.closing_window_tabs).map(([k, v]) => [Number(k) as BruhId, new Set(v)]));
        self.pre_allocated_bids_for_non_pristine_restore = new Map(Object.entries(state.pre_allocated_bids_for_non_pristine_restore)
            .map(([k, v]) => [Number(k) as BruhId, {
                ids: new Map(Object.entries(v.ids).map(([k, v]) => [Number(k) as BruhId, v])),
                left_to_restore: new Set(v.left_to_restore),
            }]));
        self.window_ids = new Map(Object.entries(state.window_ids).map(([k, v]) => [Number(k) as BruhId, v]));
        self.tab_ids = new Map(Object.entries(state.tab_ids).map(([k, v]) => [Number(k) as BruhId, v]));
        self.window_bids = new Map(Object.entries(state.window_bids).map(([k, v]) => [Number(k) as WindowId, v]));
        self.tab_bids = new Map(Object.entries(state.tab_bids).map(([k, v]) => [Number(k) as TabId, v]));
        self.forget_tids = new Set(state.forget_tids);
        self.forget_wids = new Set(state.forget_wids);
        return self;
    }

    update_tab_info(btab: Extract<StateEffect, { type: 'upate_tab_info' }>["payload"]) {
        const tbid = this.tab_bids.get(btab.tid)!;
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
        let tab_update_effect;
        if (this.is_group_tab(btab.url)) {
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
                    tab_update_effect = {
                        type: 'update_tab_url',
                        payload: { tid: btab.tid, url: this.get_group_url(tab.bid) },
                    } as Extract<AppEffect, { type: 'update_tab_url' }>;
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

        return tab_update_effect;
    }

    restore_window(wid: WindowId, old_bid: BruhId, restore_cache: Map<BruhId, NodeStorageData>) {
        const cache = restore_cache.get(old_bid);
        restore_cache.delete(old_bid);
        if (!cache || cache.type !== "window") {
            throw new Error(`wrong cache for window bid: ${old_bid} tid: ${wid}`);
        }

        const node = this.nodes.get(old_bid) as Extract<Node, { type: "window" }> | undefined;
        const is_pristine = node?.is_archived_pristine ?? false;

        let effect;
        if (node && is_pristine) {
            node.closed = false;
            node.is_archived_pristine = true;
            node.tab_bids = [];
            effect = this.register_bwindow(wid, node.bid);
        } else {
            const new_win_effect = this.create_new_window({
                hgid: cache.hgid,
                name: cache.group_name,
            });
            const wbid = new_win_effect.payload.wbid;
            effect = this.register_bwindow(wid, wbid);

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

        return effect;
    }

    restore_tab(btab: Extract<StateEffect, { type: 'tab_created' }>["payload"], old_bid: BruhId, restore_cache: Map<BruhId, NodeStorageData>) {
        const cache = restore_cache.get(old_bid);
        restore_cache.delete(old_bid);
        if (!cache || cache.type === "window") {
            throw new Error(`wrong cache for tab bid: ${old_bid} tid: ${btab.tid}`);
        }

        const node = this.nodes.get(old_bid) as Exclude<Node, { type: "window" }> | undefined;
        const win = this.get_window(this.window_bids.get(btab.wid)!);
        const is_pristine = win.is_archived_pristine ?? false;

        const effects = { type: 'effects', payload: { effects: [] } } as Extract<AppEffect, { type: 'effects' }>;
        if (node && is_pristine) {
            this.add_tab_to_window(node.bid, win.bid, cache.comes_after_bids.length);
            const e1 = this.register_btab(btab.tid, node.bid);
            effects.payload.effects.push(e1);
            const e2 = this.update_tab_info(btab);
            effects.payload.effects.push(e1);
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
            const e1 = this.register_btab(btab.tid, bid);
            effects.payload.effects.push(e1);
            const e2 = this.update_tab_info(btab);
            if (e2) effects.payload.effects.push(e2);
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
        return effects;
    }

    handle_event(event: StateEvent, app_effects: utils.Deque<AppEffect>) {
        switch (event.type) {
            case 'state_effect': {
                this.handle_effect(event.payload, app_effects);
            } break;
            case 'state_action': {
                this.handle_action(event.payload, app_effects);
            } break;
            default:
                throw utils.exhausted(event);
        }
    }

    handle_effect(effect: StateEffect, app_effects: utils.Deque<AppEffect>) {
        switch (effect.type) {
            case 'effects': {
                for (let i = 0; i < effect.payload.effects.length; i++) {
                    const e = effect.payload.effects[i]!;
                    this.handle_effect(e, app_effects);
                }
            } break;
            case 'window_removed': {
                if (!this.window_bids.has(effect.payload.wid)) return;
                const wbid = this.window_bids.get(effect.payload.wid)!;
                if (this.closing_window_tabs.has(wbid)) {
                    let tbids = this.closing_window_tabs.get(wbid)!;
                    this.closing_window_tabs.delete(wbid);

                    const win = this.get_window(wbid);
                    if (win.tab_bids.length == 1) {
                        let _ = this.remove_node(win.tab_bids[0]!);

                        const storage = this.get_node_storage_data(wbid);
                        this.browser_restore_cache.set(storage.bid, storage);
                        _ = this.remove_node(wbid);
                    } else {
                        this.mark_window_closed(wbid);
                    }
                } else {
                    const storage = this.get_node_storage_data(wbid);
                    this.browser_restore_cache.set(storage.bid, storage);
                    const _ = this.remove_node(storage.bid);
                }
            } break;
            case 'sessions_changed': {
                // TODO: completely broken. does not contain ids anywhere. not sure how to even link sessionId to tabs/windows
                // NOTE: there's no reasonable way to know what tab/window a session belongs to.
                //  - what is possible tho - is to sort of track the tabs/windows that *just* got closed and match them to newly created sessions.
                if (true) {
                    this.forget_tids.clear();
                    this.forget_wids.clear();
                }

                const sessions = effect.payload.sessions;
                for (let session of sessions) {
                    if (session.tab && session.tab.id !== undefined && session.tab.sessionId !== undefined && session.tab.windowId !== undefined) {
                        if (this.forget_tids.has(session.tab.id as TabId)) {
                            this.forget_tids.delete(session.tab.id as TabId);

                            // TODO:
                            // await browser.sessions.forgetClosedTab(session.tab.windowId, session.tab.sessionId);
                        }
                    }
                    if (session.window && session.window.id !== undefined && session.window.sessionId !== undefined) {
                        if (this.forget_wids.has(session.window.id as WindowId)) {
                            this.forget_wids.delete(session.window.id as WindowId);

                            // TODO:
                            // await browser.sessions.forgetClosedWindow(session.window.sessionId);
                        }
                    }
                }
            } break;
            case 'tab_activated': {
                const msg = effect.payload;
                if (!this.tab_bids.has(msg.activated_info.tabId as TabId)) return;
                if (!this.window_bids.has(msg.activated_info.windowId as WindowId)) return;
                const wbid = this.window_bids.get(msg.activated_info.windowId as WindowId)!;
                const tbid = this.tab_bids.get(msg.activated_info.tabId as TabId)!;
                const win = this.get_window(wbid);
                win.active = tbid;
            } break;
            case 'tab_detached': {
                // const msg = effect.payload;
                // const wid = msg.detach_info.oldWindowId as WindowId;
                // if (!this.window_bids.has(wid)) return;
                // const wbid = this.window_bids.get(wid)!;
                // const tbid = this.tab_bids.get(msg.tid)!;
                // const win = this.get_window(wbid);
                // const node = this.get_tab(tbid);
                // this.remove_tab_from_window(node.bid, win.bid);

                // if (win.tab_bids.length == 0) {
                //     const storage = this.get_node_storage_data(win.bid);
                //     this.browser_restore_cache.set(storage.bid, storage);
                //     let _ = this.remove_node(win.bid);
                // }
            } break;
            case 'tab_attached': {
                const msg = effect.payload;
                if (!this.tab_bids.has(msg.tid)) return;
                const wid = msg.attach_info.newWindowId as WindowId;
                if (!this.window_bids.has(wid)) {
                    let new_win_effect = this.create_new_window({});
                    const e = this.register_bwindow(wid, new_win_effect.payload.wbid);
                    app_effects.push_back(e);
                }
                const tbid = this.tab_bids.get(msg.tid)!;
                const node = this.get_tab(tbid);
                const wbid = this.window_bids.get(wid)!;
                if (node.wbid != wbid) {
                    let e = this.reparent_node(node.bid, wbid, msg.attach_info.newPosition);
                    app_effects.push_back(e);
                }
            } break;
            case 'tab_moved': {
                const msg = effect.payload;
                if (!this.tab_bids.has(msg.tid)) return;
                const tbid = this.tab_bids.get(msg.tid)!;
                const node = this.get_tab(tbid);
                const current_index = this.get_index(tbid);
                if (current_index == msg.move_info.toIndex) {
                    return;
                }
                if (current_index == msg.move_info.fromIndex) {
                    this.add_tab_to_window(tbid, node.wbid, msg.move_info.toIndex);
                }
            } break;
            case 'tab_removed': {
                const msg = effect.payload;
                if (!this.tab_bids.has(msg.tid)) return;
                const tbid = this.tab_bids.get(msg.tid)!;
                // can't remove the tabs here that are moved to a closed window
                if (this.is_node_closed(tbid)) return;
                const tab = this.get_tab(tbid);
                if (msg.remove_info.isWindowClosing) {
                    if (!this.closing_window_tabs.has(tab.wbid)) {
                        this.closing_window_tabs.set(tab.wbid, new Set());
                    }
                    this.closing_window_tabs.get(tab.wbid)!.add(tab.bid);
                } else {
                    const tbid = this.tab_bids.get(msg.tid)!;
                    let _ = this.remove_node_and_reparent_children(tbid);
                }

            } break;
            case 'window_created': {
                const msg = effect.payload;
                const old_wbid = effect.payload.old_wbid;
                const wid = msg.wid;
                if (this.window_bids.has(wid)) return;

                let e;
                if (old_wbid && this.browser_restore_cache.has(old_wbid)) {
                    e = this.restore_window(wid, old_wbid, this.browser_restore_cache);
                } else {
                    let new_win_effect = this.create_new_window({});
                    e = this.register_bwindow(wid, new_win_effect.payload.wbid);
                }
                app_effects.push_back(e);
            } break;
            case 'upate_tab_info': {
                const msg = effect.payload;
                if (!this.tab_bids.has(msg.tid)) return;
                const e = this.update_tab_info(msg);
                if (e) {
                    app_effects.push_back(e);
                }
            } break;
            case 'tab_created': {
                const msg = effect.payload;
                if (!this.window_bids.has(msg.wid)) {
                    const old_wbid = msg.old_wbid;
                    if (old_wbid && this.browser_restore_cache.has(old_wbid)) {
                        const e = this.restore_window(msg.wid, old_wbid, this.browser_restore_cache);
                        app_effects.push_back(e);
                    } else {
                        let new_win_effect = this.create_new_window({});
                        const e = this.register_bwindow(msg.wid, new_win_effect.payload.wbid);
                        app_effects.push_back(e);
                    }
                }
                const old_bid = msg.old_tbid;
                if (old_bid && this.browser_restore_cache.has(old_bid)) {
                    const e = this.restore_tab(msg, old_bid, this.browser_restore_cache);
                    app_effects.push_back(e);
                    return;
                }
                if (this.tab_bids.has(msg.tid)) {
                    const e = this.update_tab_info(msg);
                    if (e) app_effects.push_back(e);
                    return;
                }
                const wbid = this.window_bids.get(msg.wid)!;
                const pid = (msg.opener_tab_id !== undefined ? this.tab_bids.get(msg.opener_tab_id) : undefined) ?? wbid;

                let tbid;
                if (this.is_group_tab(msg.url)) {
                    const e = this.create_new_group(pid, { index: msg.index });
                    tbid = e.payload.bid;
                } else {
                    const e = this.create_new_tab(pid, { index: msg.index, url: msg.url, title: msg.title });
                    tbid = e.payload.bid;
                }

                const e1 = this.register_btab(msg.tid, tbid);
                app_effects.push_back(e1);
                const e2 = this.update_tab_info(msg);
                if (e2) app_effects.push_back(e2);
            } break;
            case 'register_tab': {
                const msg = effect.payload;
                let _ = this.register_btab(msg.tid, msg.bid);
            } break;
            case 'register_window': {
                const msg = effect.payload;
                let _ = this.register_bwindow(msg.wid, msg.bid);
            } break;
            default:
                throw utils.exhausted(effect);
        }
    }

    handle_action(action: StateAction, effects: utils.Deque<AppEffect>) {
        switch (action.type) {
            case 'restore_window': {
                const node = this.get_node(action.payload.wbid);
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
                const node = this.get_node(action.payload.drag_data.draggedNodeId);
                const target_node = this.get_node(action.payload.target_bid);

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

                let effect: AppEffect;
                const target = this.get_target_index(node.bid, action.payload.target_bid, action.payload.action);

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
                    if (source_win.tab_bids.length == 0 && source_win.bid !== node.bid) {
                        let _ = this.remove_node(source_win.bid);
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
                const node = this.get_node(action.payload.bid);
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
                const node = this.get_node(action.payload.bid);
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
                if (!is_closed) {
                    effects.push_back(effect);
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
            } break;
            case 'close_tabs': {
                const node = this.get_node(action.payload.bid);
                if (node.type == "window" && !action.payload.recursive) throw new Error(`expected 'tab' found 'window' bid: ${node.bid}`);
                const win = this.get_window(node.wbid);
                if (win.closed) {
                    win.is_archived_pristine = false;
                }

                if (action.payload.recursive) {
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

                const win = this.get_window(action.payload.wbid);
                if (win.closed) return;
                const wid = this.window_ids.get(win.bid)!;

                this.mark_window_closed(win.bid);

                effects.push_back({ type: 'window_closed', payload: { wid } });
            } break;
            case 'delete_window_state': {
                const win = this.get_window(action.payload.wbid);
                if (!win.closed) throw new Error(`cannot delete state for open window with bid: ${win.bid}`);
                const tbids = [...win.tab_bids];
                let _;
                for (let bid of tbids) {
                    _ = this.remove_node(bid);
                }
                _ = this.remove_node(win.bid);
            } break;
            case 'reload_tree': {
                const root = this.get_node(action.payload.bid);
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
                const node = this.get_node(action.payload.bid);
                const win = this.get_window(node.wbid);
                if (win.closed) return;
                const bids = action.payload.recursive ? this.get_subtree(action.payload.bid) : [node.bid];

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
                const node = this.get_tab(action.payload.bid);
                const win = this.get_window(node.wbid);
                if (win.closed) return;
                win.active = node.bid;

                effects.push_back({ type: 'tab_focused', payload: { bid: node.bid } });
            } break;
            case 'create_group': {
                const parent_bid = action.payload.parent_bid;
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
                const url = action.payload.url;
                const parent_bid = action.payload.parent_bid;
                const parent = this.get_node(parent_bid);
                const win = this.get_window(parent.wbid);
                if (win.closed) {
                    win.is_archived_pristine = false;
                }

                const bid = this.bruhid++ as BruhId;
                const target = this.get_target_index(bid, parent.bid, action.payload.action);
                let create_effect;
                if (!!url && this.parse_group_url_id(url) !== null) {
                    create_effect = this.create_new_group(parent.bid, { bid: bid, index: target.index });
                } else {
                    create_effect = this.create_new_tab(parent.bid, { bid: bid, url: url, index: target.index });
                }

                if (!win.closed) {
                    effects.push_back(create_effect);
                }
            } break;
            case 'toggle_collapse': {
                const node = this.get_node(action.payload.bid);
                node.collapsed = !node.collapsed;
            } break;
            case 'flatten_tree': {
                const node = this.get_node(action.payload.bid);
                const win = this.get_window(node.wbid);
                if (win.closed) {
                    win.is_archived_pristine = false;
                }

                this.flatten_node(node.bid, action.payload.recursive, this.increment_hgid());
            } break;
            case 'rename_node': {
                const node = this.get_node(action.payload.bid);
                if (node.type == "tab") {
                    throw new Error(`'tab' nodes cannot be renamed`);
                }

                const win = this.get_window(node.wbid);
                if (win.closed) {
                    win.is_archived_pristine = false;
                }

                node.name.name = action.payload.new_name;
                node.name.is_custom = true;
            } break;
            case 'load_bruh_export': {
                this.load_export_data(action.payload.data);
            } break;
            case 'create_snapshot': {
                this.create_snapshot(action.payload.name);
            } break;
            case 'delete_snapshot': {
                this.delete_snapshot(action.payload.id);
            } break;
            case 'restore_snapshot_window': {
                this.restore_snapshot_window(action.payload.id, action.payload.window_index);
            } break;
            case 'restore_snapshot_subtree': {
                this.restore_snapshot_subtree(action.payload.id, action.payload.window_index, action.payload.tab_index);
            } break;
            case 'import_file_as_snapshot': {
                let bruhData: BruhExport;
                const data = action.payload.data;
                if ('id' in data && 'sidebar' in data) {
                    bruhData = State.convert_sideberry_export_to_bruh(data as SideberryExport);
                } else {
                    bruhData = data as BruhExport;
                }

                const newSnapshot: Snapshot = {
                    id: this.rng.nextUUID(),
                    name: action.payload.name,
                    timestamp: new Date().toISOString(),
                    data: bruhData
                };
                this.snapshots.push(newSnapshot);
            } break;
            case 'handle_snapshot_drop': {
                const { drag_data, target_bid, action: target_action, target_wid } = action.payload;
                const snapshot = this.snapshots.find(s => s.id === drag_data.snapshotId);
                if (!snapshot) break;

                const windowData = snapshot.data.windows[drag_data.windowIndex];
                if (!windowData) break;

                const tabsToRestore = this._get_snapshot_subtree_tabs(windowData, drag_data.tabIndex);

                let parentForRestore: BruhId;
                let insertionIndex: number | undefined;

                if (target_wid) { // Context menu case: restore to root of target window
                    const target_wbid = this.window_bids.get(target_wid);
                    if (!target_wbid) break;
                    parentForRestore = target_wbid;
                    // Index is undefined to append to the end of the window's root.
                } else { // Drag-drop case: use target and action for positioning
                    const target = this.get_target_index(-1 as BruhId, target_bid, target_action);
                    parentForRestore = target.parent_bid;
                    insertionIndex = target.index;
                }

                let effect;
                if (drag_data.tabIndex === undefined) { // Dragging a whole snapshot window
                    const groupEffect = this.create_new_group(parentForRestore, {
                        name: { name: windowData.name ?? 'Restored Window', generation: 0, is_custom: true },
                        index: insertionIndex,
                    });
                    effect = this.load_tabs_into_parent(tabsToRestore, groupEffect.payload.bid);
                    if (effect) {
                        effects.push_back({ type: 'effects', payload: { effects: [groupEffect, effect] } });
                    }
                } else { // Dragging a snapshot subtree
                    effect = this.load_tabs_into_parent(tabsToRestore, parentForRestore, insertionIndex);
                    if (effect) effects.push_back(effect);
                }
            } break;
            case 'toggle_snapshot_collapse': {
                const { snapshot_id, window_index, tab_index } = action.payload;
                const snapshot = this.snapshots.find(s => s.id === snapshot_id);
                if (snapshot) {
                    const windowData = snapshot.data.windows[window_index];
                    if (windowData) {
                        const tabData = windowData.tabs[tab_index];
                        if (tabData) {
                            tabData.collapsed = !tabData.collapsed;
                        }
                    }
                }
            } break;
            case 'toggle_snapshot_window_collapse': {
                const { snapshot_id, window_index } = action.payload;
                const snapshot = this.snapshots.find(s => s.id === snapshot_id);
                if (snapshot) {
                    const windowData = snapshot.data.windows[window_index];
                    if (windowData) {
                        windowData.collapsed = !(windowData.collapsed ?? false);
                    }
                }
            } break;
            case 'update_user_config': {
                this.user_config = { ...this.user_config, ...action.payload.config };
            } break;
            default:
                throw utils.exhausted(action);
        }

    }
}

