import browser from 'webextension-polyfill';
import type {
    AppRequest,
    StateAction,
    AppResponse,
    Node,
    TabId,
    AppEvent,
    WindowId,
    BruhId,
    NodeStorageData,
    AppEffect,
    StateStorage,
    ConfigStorage,
    StateEffect,
    ExtensionAction,
    ClonableState,
    StateEvent,
    BruhUiEvent,
} from './types';
import * as utils from './utils';
import { State } from './state';
import manifest from './manifest.jsonc';

class App {
    ports: Set<browser.Runtime.Port> = new Set();
    eventChannel: utils.Channel<AppEvent> = new utils.Channel();

    state: State;
    clonable_state: ClonableState;
    state_events: StateEvent[] = [];

    private session_pointer_key = "tabruh-bruh-id";
    private storage_state_key = "tabruh-app-state";
    private storage_config_key = "tabruh-app-config";

    static init() {
        const version: string = manifest["version"];
        console.log(`tabruh loaded: v${version}`);

        let state = new State(version);
        let self = new App(state);
        return self;
    }

    constructor(state: State) {
        this.state = state;
        this.clonable_state = state.clonable_state();
    }

    attach_listeners() {
        browser.runtime.onInstalled.addListener(async () => {
            browser.menus.create({
                id: "open-overview",
                title: "Overview Page",
                contexts: ["browser_action"],
            });
            browser.menus.create({
                id: "open-settings",
                title: "Open Settings",
                contexts: ["browser_action"],
            });
            browser.menus.create({
                id: "clear-state",
                title: "Clear state",
                contexts: ["all"],
            });
        });
        browser.menus.onClicked.addListener(async (info, tab) => {
            switch (info.menuItemId) {
                case "open-overview": {
                    await browser.tabs.create({
                        url: browser.runtime.getURL("overview.html"),
                    });
                } break;
                case "open-settings": {
                    await browser.tabs.create({
                        url: browser.runtime.getURL("settings.html"),
                    });
                } break;
                case "clear-state": {
                    await browser.storage.local.remove(this.storage_config_key);
                    await browser.storage.local.remove(this.storage_state_key);
                } break;
                default:
                    console.warn("unknown menu item id " + info.menuItemId);
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
                const msg = message as ExtensionAction;
                switch (msg.type) {
                    case 'app_request':
                        await this.eventChannel.send({ type: 'app_request', payload: { message: msg.payload as AppRequest, port } });
                        break;
                    case 'state_action':
                        await this.eventChannel.send({ type: 'state_action', payload: { message: msg.payload as StateAction, port } });
                        break;
                    default:
                        throw utils.exhausted(msg);
                }
            });
            port.onDisconnect.addListener(() => {
                this.ports.delete(port);
            });
        });
        browser.tabs.onCreated.addListener(async (tab) => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'tab_created', payload: { tab: tab } },
            });
        });
        browser.tabs.onRemoved.addListener(async (tid, remove_info) => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'tab_removed', payload: { tid: tid as TabId, remove_info } },
            });
        });
        browser.tabs.onUpdated.addListener(async (tid, change_info, tab) => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'tab_updated', payload: { tid: tid as TabId, change_info, tab } },
            });
        });
        browser.tabs.onMoved.addListener(async (tid, move_info) => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'tab_moved', payload: { tid: tid as TabId, move_info } },
            });
        });
        browser.tabs.onAttached.addListener(async (tid, attach_info) => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'tab_attached', payload: { tid: tid as TabId, attach_info } },
            });
        });
        browser.tabs.onDetached.addListener(async (tid, detach_info) => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'tab_detached', payload: { tid: tid as TabId, detach_info } },
            });
        });
        browser.tabs.onActivated.addListener(async (activated_info) => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'tab_activated', payload: { activated_info } },
            });
        });
        browser.windows.onCreated.addListener(async (win) => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'window_created', payload: { win } },
            });
        });
        browser.windows.onRemoved.addListener(async (wid) => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'window_removed', payload: { wid: wid as WindowId } },
            });
        });
        browser.windows.onFocusChanged.addListener(async (wid) => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'window_focus_changed', payload: { wid: wid as WindowId } },
            });
        });
        browser.sessions.onChanged.addListener(async () => {
            let _ = await this.eventChannel.send({
                type: "browser_event",
                payload: { type: 'sessions_changed', payload: {} },
            });
        });
    }

    _post(port: browser.Runtime.Port, message: BruhUiEvent) {
        try {
            port.postMessage(message);
        } catch (e) {
            this.ports.delete(port);
        }
    }

    _broadcast(message: BruhUiEvent) {
        for (const port of this.ports) {
            this._post(port, message);
        }
    }

    _broadcast_state_effect(effect: StateEffect) {
        this._broadcast({ type: 'state_effect', payload: effect });
    }

    _broadcast_state_action(action: StateAction) {
        this._broadcast({ type: 'state_action', payload: action });
    }

    async process_events() {
        const app_effects = new utils.Deque<AppEffect>();
        const state_effects = new utils.Deque<StateEffect>();
        while (true) {
            const event = await this.eventChannel.wait_recv();
            if (!event) break;

            if (this.state.user_config.dbg_log_events) {
                this._log_event(event);
            }

            await this.process_event(event, state_effects, app_effects).catch(console.error);
            this.process_state_effects(state_effects, app_effects);
            await this.process_app_effects(app_effects);
            await this.save_state().catch(console.error);
        }
    }

    async process_state_effects(state_effects: utils.Deque<StateEffect>, app_effects: utils.Deque<AppEffect>) {
        while (true) {
            const effect = state_effects.pop_front();
            if (!effect) break;

            if (this.state.user_config.dbg_log_effects) {
                // TODO:
                // this._log_effect(effect);
            }
            this.state.handle_effect(effect, state_effects, app_effects);
        }
    }

    async process_app_effects(effects: utils.Deque<AppEffect>) {
        while (true) {
            const effect = effects.pop_front();
            if (!effect) break;

            if (this.state.user_config.dbg_log_effects) {
                this._log_effect(effect);
            }
            await this._process_effect(effects, effect).catch(console.error);
        }
    }

    async save_state() {
        const state = this.state.serialize_state();
        await browser.storage.local.set({ [this.storage_state_key]: state.state });
        await browser.storage.local.set({
            [this.storage_config_key]: state.config,
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
                config_version: this.state.extension_version,
                user_config: { ...this.state.user_config },
            };
        } else {
            return config;
        }
    }

    async load_state(key: string) {
        const result = await browser.storage.local.get(key);
        const state = result[key] as StateStorage;
        if (!state) {
            const nodes: Map<BruhId, Node> = new Map();
            const node_storage: Map<BruhId, NodeStorageData> = new Map();
            for (const [bid, node] of this.state.nodes.entries()) {
                const storage = this.state.get_node_storage_data(bid);
                node_storage.set(bid, storage);
                nodes.set(bid, node);
            }
            const browser_restore_cache: Map<BruhId, NodeStorageData> = new Map();
            for (const [bid, storage] of this.state.browser_restore_cache.entries()) {
                browser_restore_cache.set(bid, storage);
            }
            return structuredClone({
                rng_state: this.state.rng.s,
                state_version: this.state.extension_version,
                bruh_session_key: this.state.bruh_session_key,
                bruhid: this.state.bruhid,
                hierarchy_generation_id: this.state.hierarchy_generation_id,
                nodes: nodes,
                node_storage_data: node_storage,
                browser_restore_cache: this.state.browser_restore_cache,
                snapshots: this.state.snapshots,
            });
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
            rng_state: state.rng_state,
            state_version: state.state_version,
            bruh_session_key: state.bruh_session_key,
            bruhid: state.bruhid,
            hierarchy_generation_id: state.hgid,
            nodes: nodes,
            node_storage_data: node_storage,
            browser_restore_cache: cache,
            snapshots: state.snapshots,
        };
    }

    async write_session_pointer(bid: BruhId, id: TabId | WindowId, type: 'tab' | 'window'): Promise<void> {
        if (!this.state.config.available_apis.session_values) return;
        const data = { bid, bruh_session_key: this.state.bruh_session_key };
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
        if (!this.state.config.available_apis.session_values) return;
        try {
            let data: any;
            if (type === 'tab') {
                data = await browser.sessions.getTabValue(id as TabId, this.session_pointer_key);
            } else {
                data = await browser.sessions.getWindowValue(id as WindowId, this.session_pointer_key);
            }
            if (this.state.bruh_session_key == data?.bruh_session_key) {
                return data?.bid;
            } else {
                return undefined;
            }
        } catch (e) {
            return undefined;
        }
    }

    async register_bwindow(wid: WindowId, bid: BruhId) {
        let _ = this.state.register_bwindow(wid, bid);
        await this.write_session_pointer(bid, wid, "window");
    }

    async register_btab(btab: browser.Tabs.Tab, bid: BruhId) {
        let _ = this.state.register_btab(btab.id as TabId, bid);
        await this.write_session_pointer(bid, btab.id as TabId, "tab");
    }

    async init_tree() {
        const config = await this.load_config();
        // TODO: some way to easily migrate using `config.config_version`
        this.state.user_config = config.user_config;

        let state = await this.load_state(this.storage_state_key);
        // TODO: some way to easily migrate using `state.state_version`
        if (this.state.user_config.dbg_reset_state_on_load) {
            state = await this.load_state("blah");
        }
        this.state.rng.s = state.rng_state;
        this.state.bruh_session_key = state.bruh_session_key;
        this.state.bruhid = state.bruhid;
        this.state.hierarchy_generation_id = state.hierarchy_generation_id;
        this.state.browser_restore_cache = state.browser_restore_cache;
        this.state.snapshots = state.snapshots;

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

        const app_effects = new utils.Deque<AppEffect>();
        const new_tabs_to_reparent_via_opener_id = new Set();
        // in this pass we try to restore only the windows that were open/closed+pristine, because the non-pristine closed windows
        // can only be restored by the extension
        for (const bwin of bwins) {
            const old_wbid = old_wbids.get(bwin.id as WindowId);
            if (!old_wbid) {
                // we create completely new windows here
                let new_win_effect = this.state.create_new_window({});
                await this.register_bwindow(bwin.id as WindowId, new_win_effect.payload.wbid);
            } else {
                const node = state.nodes.get(old_wbid) as Extract<Node, { type: "window" }>;
                if (!node) {
                    // windows that were restored via the browser restore api after the state for it was deleted
                    const e = this.state.restore_window(bwin.id as WindowId, old_wbid, this.state.browser_restore_cache);
                    app_effects.push_back(e);
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
                    const e = this.state.restore_window(bwin.id as WindowId, old_wbid, state.node_storage_data);
                    app_effects.push_back(e);
                }
            }
            await this.process_app_effects(app_effects);

            // TODO: MAYBE: there's probably a subtle bug somewhere in here,
            //    where a non-pristine/pristine restored tab is moved to a pristine/non-pristine restored window,
            //    and the restore logic explodes
            // NOTE tho:
            //  - we never can do a pristine restore here cuz this.nodes does not contain a window with .is_archived_pristine = true
            const win = this.state.get_window(this.state.window_bids.get(bwin.id as WindowId)!);
            for (const btab of bwin.tabs!) {
                const old_tbid = old_tbids.get(btab.id as TabId);
                const tab_info = {
                    old_tbid: undefined,
                    old_wbid: undefined,
                    tid: btab.id as TabId,
                    wid: bwin.id as WindowId,
                    opener_tab_id: btab.openerTabId as TabId,
                    index: btab.index,
                    url: btab.url,
                    favIconUrl: btab.favIconUrl,
                    title: btab.title,
                    discarded: btab.discarded,
                };
                let needs_new_tab = false;
                if (old_tbid) {
                    const node = state.nodes.get(old_tbid) as Exclude<Node, { type: "window" }>;
                    if (!node) {
                        if (this.state.browser_restore_cache.has(old_tbid)) {
                            const e = this.state.restore_tab(tab_info, old_tbid, this.state.browser_restore_cache);
                            app_effects.push_back(e);
                        } else {
                            needs_new_tab = true;
                        }
                    } else {
                        const e = this.state.restore_tab(tab_info, old_tbid, state.node_storage_data);
                        app_effects.push_back(e);
                    }
                } else {
                    needs_new_tab = true;
                }

                if (needs_new_tab) {
                    if (btab.openerTabId !== undefined) {
                        new_tabs_to_reparent_via_opener_id.add(btab.id!);
                    }
                    let tab;
                    if (this.state.is_group_tab(btab.url)) {
                        const new_tab_effect = this.state.create_new_group(win.bid, { index: btab.index });
                        tab = this.state.get_tab(new_tab_effect.payload.bid);
                    } else {
                        const new_tab_effect = this.state.create_new_tab(win.bid, {
                            url: btab.url,
                            title: btab.title ?? "Untitled",
                            index: btab.index,
                        });
                        tab = this.state.get_tab(new_tab_effect.payload.bid);
                    }
                    const e = this.state.register_btab(btab.id as TabId, tab.bid);
                    app_effects.push_back(e);
                    const e1 = this.state.update_tab_info(tab_info);
                    if (e1) app_effects.push_back(e1);
                }

                const tab = this.state.get_tab(this.state.tab_bids.get(btab.id as TabId)!);
                if (btab.active) {
                    win.active = tab.bid;
                }

                await this.process_app_effects(app_effects);
            }
        }

        for (const [wbid, data] of this.state.pre_allocated_bids_for_non_pristine_restore.entries()) {
            this.state.pre_allocated_bids_for_non_pristine_restore.delete(wbid);
            const win = this.state.get_window(wbid);
            win.is_archived_pristine = undefined;
        }

        for (const tid of new_tabs_to_reparent_via_opener_id) {
            for (const bwin of bwins) {
                for (const btab of bwin.tabs!) {
                    if (btab.id !== tid) {
                        const bid = this.state.tab_bids.get(tid as TabId)!;
                        const node = this.state.get_node(bid);
                        if (!this.state.tab_bids.has(btab.openerTabId! as TabId)) {
                            break;
                        }
                        const pbid = this.state.tab_bids.get(btab.openerTabId as TabId)!;
                        this.state.reparent_node(node.bid, pbid);
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
            this.state.nodes.set(wnode.bid, wnode);
            for (const tbid of wnode.tab_bids) {
                const tnode = state.nodes.get(tbid)! as Exclude<Node, { type: "window" }>;
                this.state.nodes.set(tnode.bid, tnode);
            }
        }

        this.clonable_state = this.state.clonable_state();
        this.state_events = [];
    }

    _log_event(event: AppEvent) {
        switch (event.type) {
            case 'browser_event':
                switch (event.payload.type) {
                    case 'tab_created':
                    case 'tab_removed':
                    case 'tab_moved':
                    case 'tab_attached':
                    case 'tab_detached':
                    case 'window_created':
                    case 'window_removed':
                    case 'sessions_changed':
                        console.log(Date.now(), event.payload.type, event.payload.payload);
                        break;
                    case 'tab_updated':
                    case 'tab_activated':
                    case 'window_focus_changed':
                        break;
                    default:
                        throw utils.exhausted(event.payload);
                }
                break;
            case 'app_request':
                switch (event.payload.message.type) {
                    case 'export_data':

                    case 'convert_sideberry_export':
                    case 'get_initial_state':
                        break;
                    default:
                        throw utils.exhausted(event.payload.message);
                }
                break;
            case 'state_action':
                switch (event.payload.message.type) {
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
                    case 'load_bruh_export':
                    case 'update_user_config':
                    case 'create_snapshot':
                    case 'delete_snapshot':
                    case 'restore_snapshot_window':
                    case 'restore_snapshot_subtree':
                    case 'import_file_as_snapshot':
                    case 'handle_snapshot_drop':
                    case 'toggle_snapshot_collapse':
                    case 'toggle_snapshot_window_collapse':
                        console.log(Date.now(), event.payload.message.type, event.payload.message.payload);
                        break;

                    default:
                        throw utils.exhausted(event.payload.message);
                }
                break;
            default:
                throw utils.exhausted(event);
        }
    }

    _log_effect(effect: AppEffect) {
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
            case 'write_window_session':
            case 'write_tab_session':
            case 'update_tab_url':
                break;
            default:
                throw utils.exhausted(effect);
        }
    }

    async process_event(event: AppEvent, state_effects: utils.Deque<StateEffect>, app_effects: utils.Deque<AppEffect>) {
        switch (event.type) {
            case 'browser_event': {
                const msg = event.payload;
                switch (msg.type) {
                    case 'tab_created': {
                        const btab = msg.payload.tab;
                        if (btab.id === undefined || btab.windowId === undefined) return;
                        const old_wbid = await this.read_session_pointer(btab.windowId as WindowId, "window");
                        const old_tbid = await this.read_session_pointer(btab.id as TabId, "tab");

                        const effect: StateEffect = {
                            type: 'tab_created',
                            payload: {
                                old_wbid,
                                old_tbid,
                                wid: btab.windowId as WindowId,
                                tid: btab.id as TabId,
                                url: btab.url,
                                favIconUrl: btab.favIconUrl,
                                title: btab.title,
                                discarded: btab.discarded,
                                opener_tab_id: btab.openerTabId as TabId,
                                index: btab.index,
                            },
                        };
                        state_effects.push_back(effect);
                        this.state_events.push({ type: 'state_effect', payload: effect });
                        this._broadcast_state_effect(effect);
                    } break;
                    case 'tab_removed': {
                        state_effects.push_back(msg);
                        this.state_events.push({ type: 'state_effect', payload: msg });
                        this._broadcast_state_effect(msg);
                    } break;
                    case 'tab_updated': {
                        const btab = msg.payload.tab;
                        const effect: StateEffect = {
                            type: 'upate_tab_info',
                            payload: {
                                tid: btab.id as TabId,
                                url: btab.url,
                                favIconUrl: btab.favIconUrl,
                                title: btab.title,
                                discarded: btab.discarded,
                            },
                        };
                        state_effects.push_back(effect);
                        this.state_events.push({ type: 'state_effect', payload: effect });
                        this._broadcast_state_effect(effect);
                    } break;
                    case 'tab_moved': {
                        state_effects.push_back(msg);
                        this.state_events.push({ type: 'state_effect', payload: msg });
                        this._broadcast_state_effect(msg);
                    } break;
                    case 'tab_attached': {
                        state_effects.push_back(msg);
                        this.state_events.push({ type: 'state_effect', payload: msg });
                        this._broadcast_state_effect(msg);
                    } break;
                    case 'tab_detached': {
                        // we just rely on 'tab_attached' to do the state changes for detach too
                    } break;
                    case 'tab_activated': {
                        state_effects.push_back(msg);
                        this.state_events.push({ type: 'state_effect', payload: msg });
                        this._broadcast_state_effect(msg);
                    } break;
                    case 'window_created': {
                        const bwin = msg.payload.win;
                        if (bwin.id === undefined) return;
                        const old_wbid = await this.read_session_pointer(bwin.id as WindowId, "window");
                        const effect: StateEffect = { type: 'window_created', payload: { old_wbid, wid: bwin.id as WindowId } };
                        state_effects.push_back(effect);
                        this.state_events.push({ type: 'state_effect', payload: effect });
                        this._broadcast_state_effect(effect);
                    } break;
                    case 'window_removed': {
                        state_effects.push_back(msg);
                        this.state_events.push({ type: 'state_effect', payload: msg });
                        this._broadcast_state_effect(msg);
                    } break;
                    case 'window_focus_changed': {
                        // nothing to do
                    } break;
                    case 'sessions_changed': {
                        const sessions = await browser.sessions.getRecentlyClosed();
                        const effect: StateEffect = { type: 'sessions_changed', payload: { sessions } };
                        state_effects.push_back(effect);
                        this.state_events.push({ type: 'state_effect', payload: effect });
                        this._broadcast_state_effect(effect);
                    } break;
                    default:
                        throw utils.exhausted(msg);
                }
            } break;
            case 'state_action': {
                this.state_events.push({ type: event.type, payload: event.payload.message });
                this.state.handle_action(event.payload.message, app_effects);
                this._broadcast_state_action(event.payload.message);
            } break;
            case 'app_request': {
                const msg = event.payload.message;
                switch (msg.type) {
                    case 'export_data': {
                        const data = this.state.get_export_data(true);
                        const jsonData = JSON.stringify(data, null, 2);
                        const blob = new Blob([jsonData], { type: "application/json" });
                        const url = URL.createObjectURL(blob);

                        const now = new Date();
                        const timestamp = now.toISOString().replace(/[:.]/g, '-');
                        const filename = `tabruh-export-${timestamp}.json`;
                        let _ = await browser.downloads.download({ url, filename, saveAs: true });

                        setTimeout(() => URL.revokeObjectURL(url), 5000);
                    } break;
                    case 'convert_sideberry_export': {
                        const data = State.convert_sideberry_export_to_bruh(msg.payload.data);
                        this._post(event.payload.port, { type: 'app_response', payload: { type: 'converted_sideberry_export_ready', payload: { data } } });
                    } break;
                    case 'get_initial_state': {
                        const data = this.state.clonable_state();
                        this._post(event.payload.port, { type: 'app_response', payload: { type: 'initial_state', payload: data } });
                    } break;
                    default:
                        throw utils.exhausted(msg);
                } break;
            } break;
            default:
                throw utils.exhausted(event);
        }
    }

    async _process_effect(effects: utils.Deque<AppEffect>, effect: AppEffect) {
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
                const node = this.state.get_tab(effect.payload.bid);
                const win = this.state.get_window(node.wbid);
                const wid = this.state.window_ids.get(node.wbid);
                const index = this.state.get_index(node.bid);
                const active = win.active == node.wbid;

                let url;
                let title;
                if (node.type == 'tab') {
                    url = node.url;
                    title = node.title;
                } else {
                    url = this.state.get_group_url(node.bid);
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
                const node = this.state.get_tab(effect.payload.bid);
                const tid = this.state.tab_ids.get(node.bid);
                if (tid === undefined) throw new Error(`non null tid expected for '${effect.type}'`);
                let _ = await browser.tabs.update(tid, { active: true });
            } break;
            case 'tabs_moved': {
                const wid = this.state.window_ids.get(effect.payload.wbid);
                if (wid === undefined) throw new Error(`non null wid expected for ${effect.type}`)
                let _ = await browser.tabs.move(effect.payload.tbids.map(tbid => this.state.tab_ids.get(tbid)!), {
                    windowId: wid,
                    index: effect.payload.index,
                });
            } break;
            case 'tabs_discarded': {
                const tids = [];
                for (const tbid of effect.payload.tbids) {
                    let tid = this.state.tab_ids.get(tbid);
                    if (tid === undefined) {
                        throw new Error(`non null tid expected for ${effect.type}`);
                    }
                    tids.push(tid);
                }
                let _ = await browser.tabs.discard(tids as TabId[]);
            } break;
            case 'tabs_reloaded': {
                for (const tbid of effect.payload.tbids) {
                    let tid = this.state.tab_ids.get(tbid);
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
                const win = this.state.get_window(effect.payload.wbid);
                let tbids = [...win.tab_bids];
                const indexof_active = tbids.indexOf(win.active ?? tbids[0]!);
                if (indexof_active < 0) throw new Error(`win.active does not exist in win.tab_bids for wbid: ${win.bid}`);
                const active = tbids.splice(indexof_active, 1)[0]!;

                let bwin;
                if (this.state.tab_ids.has(active)) {
                    bwin = await browser.windows.create({
                        tabId: this.state.tab_ids.get(active)!,
                    });
                } else {
                    bwin = await browser.windows.create({
                        url: this.state.get_node_url(active),
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
                    if (this.state.tab_ids.has(tbid)) {
                        let _ = await browser.tabs.move(this.state.tab_ids.get(tbid)!, { windowId: bwin.id!, index: i });
                    } else {
                        let btab = await browser.tabs.create({
                            windowId: bwin.id!,
                            url: this.state.get_node_url(tbid),
                            index: i,
                            discarded: true,
                            active: false,
                            title: this.state.get_node_name(tbid),
                        });
                        await this.register_btab(btab, tbid);
                    }
                    i += 1;
                }
            } break;
            case 'window_closed': {
                await browser.windows.remove(effect.payload.wid);
            } break;
            case 'write_window_session': {
                await this.write_session_pointer(effect.payload.bid, effect.payload.wid, "window");
            } break;
            case 'write_tab_session': {
                await this.write_session_pointer(effect.payload.bid, effect.payload.tid, "tab");
            } break;
            case 'update_tab_url': {
                await browser.tabs.update(effect.payload.tid, { url: effect.payload.url });
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
