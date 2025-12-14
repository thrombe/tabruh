import browser from 'webextension-polyfill';
import * as utils from './utils';

export type TabId = utils.Branded<number, "TabId">;
export type WindowId = utils.Branded<number, "WindowId">;
export type BrowserId = TabId | WindowId;

export type BruhId = utils.Branded<number, "BruhId">;
export type HierarchyGenerationId = utils.Branded<number, "HgId">;

export type Snapshot = {
    id: string,
    name: string,
    timestamp: string, // ISO string
    data: BruhExport,
};

export type DllLruCacheState<K, V> = {
    first: K | null,
    last: K | null,
    map: Record<string, { val: V, next: K | null, prev: K | null }>,
};

export type StateStorage = {
    rng_state: utils.Xoshiro256State,
    state_version: string,
    bruh_session_key: string,
    bruhid: BruhId,
    hgid: HierarchyGenerationId,
    nodes: Record<string, Node>,
    node_storage_data: Record<string, NodeStorageData>,
    browser_restore_cache: DllLruCacheState<BruhId, NodeStorageData>,
};

export type Config = {
    available_apis: {
        session_values: boolean,
    },
    features: {
        restore_strategy: "SessionsValues" | "SessionHistory",
        url_open_restricted: boolean,
    },
};
export type UserConfig = {
    dbg_reset_state_on_load: boolean,
    dbg_log_events: boolean,
    dbg_log_effects: boolean,
    dbg_log_state_effects: boolean,
    dbg_log_state_actions: boolean,
    restore_cache_size: number,
    open_sidebar_on_new_windows: boolean,
    new_tab_url?: string,
};
export type ConfigStorage = {
    config_version: string,
    user_config: UserConfig,
};

export type SerializableState = {
    config: ConfigStorage,
    state: StateStorage,
    snapshots: Snapshot[],
};

// state that can be used to clone State
export type ClonableState = {
    config: Config;
    user_config: UserConfig,
    rng_state: utils.Xoshiro256State,
    extension_version: string,
    bruh_session_key: string,
    bruhid: BruhId,
    hgid: HierarchyGenerationId,
    nodes: Record<string, Node>,
    browser_restore_cache: DllLruCacheState<BruhId, NodeStorageData>,
    snapshots: Snapshot[],
    tab_name_cache: Record<string, GroupName>;
    closing_window_tabs: Record<string, BruhId[]>;
    pre_allocated_bids_for_non_pristine_restore: Record<string, {
        ids: Record<string, BruhId>,
        left_to_restore: BruhId[],
    }>;

    window_ids: Record<string, WindowId>;
    tab_ids: Record<string, TabId>;
    window_bids: Record<string, BruhId>;
    tab_bids: Record<string, BruhId>;

    forget_tids: TabId[];
    forget_wids: WindowId[];
};

export type NodeStorageData = {
    bid: BruhId,
    parent_bid: BruhId,
    wbid: BruhId,
    ancestor_bids: BruhId[],
    children_bids: BruhId[],
    // ids of all the things this tab comes after in the same group.
    // necessary to restore the exact position of tabs.
    comes_after_bids: BruhId[],
    hgid: HierarchyGenerationId,
    cache_hgid: HierarchyGenerationId,
} & ({
    type: "tab",
    url: string,
    title: string,
    collapsed: boolean,
    cached_group_name?: GroupName,
} | {
    type: "group",
    group_name: GroupName,
    collapsed: boolean,
} | {
    type: "window",
    group_name: GroupName,
    tab_bids: BruhId[],
});

export type GroupName = {
    name: string;
    // use to sort windows on screen (persists when window <-> group conversions)
    generation: number,
    is_custom: boolean,
};

export type Node = {
    bid: BruhId,
    wbid: BruhId,
    hgid: HierarchyGenerationId,
} & ({
    type: "tab",
    parent_bid: BruhId,
    collapsed: boolean,

    discarded: boolean,

    url: string,
    title: string,
    fav_icon_url?: string,
} | {
    type: "group",
    parent_bid: BruhId,
    collapsed: boolean,

    discarded: boolean,

    name: GroupName,
} | {
    type: "window",
    parent_bid: BruhId & 0,
    collapsed: false,

    active?: BruhId,
    tab_bids: BruhId[],
    is_archived_pristine?: boolean,
    closed: boolean,

    name: GroupName,
});

export type TabData = Extract<Node, { type: "tab" | "group" }>;
export type UrlTabData = Extract<Node, { type: "tab" }>;
export type GroupTabData = Extract<Node, { type: "group" }>;
export type WindowData = Extract<Node, { type: "window" }>;

export type DragType = 'tabs' | 'window';
export type DropAction = 'above' | 'below' | 'inside';

export type LiveDragData = {
    type: DragType,
    sourceWindowId: BruhId,
    draggedNodeId: BruhId,
    movedNodeIds: BruhId[],
};

export type SnapshotDragData = {
    type: 'snapshot_item',
    snapshotId: string,
    windowIndex: number,

    // Undefined if dragging the whole window
    tabIndex?: number,
};

export type DragData = LiveDragData | SnapshotDragData;

export type AppRequest =
    | { type: 'get_initial_state', payload: {} }
    | { type: 'export_data', payload: {} }
    | { type: 'convert_sideberry_export', payload: { data: SideberryExport } }
    | { type: 'get_logs', payload: {} }
    ;

export type AppResponse =
    | { type: 'initial_state', payload: ClonableState }
    | { type: 'converted_sideberry_export_ready', payload: { data: BruhExport } }
    | { type: 'snapshots_list_update', payload: { snapshots: Snapshot[] } }
    ;

export type StateAction =
    | { type: 'focus_tab', payload: { bid: BruhId } }
    | { type: 'close_tabs', payload: { bid: BruhId, recursive: boolean } }
    | { type: 'toggle_collapse', payload: { bid: BruhId } }
    | { type: 'handle_drop', payload: { drag_data: LiveDragData, target_bid: BruhId, action: DropAction } }
    | { type: 'duplicate_tab', payload: { bid: BruhId } }
    | { type: 'unload_tabs', payload: { bid: BruhId, recursive: boolean } }
    | { type: 'reload_tree', payload: { bid: BruhId } }
    | { type: 'move_subtree_to_new_window', payload: { bid: BruhId } }
    | { type: 'create_tab', payload: { url?: string, parent_bid: BruhId, action: DropAction } }
    | { type: 'close_window', payload: { wbid: BruhId } }
    | { type: 'restore_window', payload: { wbid: BruhId } }
    | { type: 'delete_window_state', payload: { wbid: BruhId } }
    | { type: 'flatten_tree', payload: { bid: BruhId, recursive: boolean } }
    | { type: 'create_group', payload: { parent_bid: BruhId } }
    | { type: 'rename_node', payload: { bid: BruhId, new_name: string } }
    | { type: 'load_bruh_export', payload: { data: BruhExport } }
    | { type: 'update_user_config', payload: { config: Partial<UserConfig> } }
    | { type: 'create_snapshot', payload: { name: string } }
    | { type: 'delete_snapshot', payload: { id: string } }
    | { type: 'restore_snapshot_window', payload: { id: string, window_index: number } }
    | { type: 'restore_snapshot_subtree', payload: { id: string, window_index: number, tab_index: number } }
    | { type: 'import_file_as_snapshot', payload: { data: BruhExport | SideberryExport, name: string } }
    | { type: 'handle_snapshot_drop', payload: { drag_data: SnapshotDragData, target_bid: BruhId, action: DropAction, target_wid?: WindowId } }
    | { type: 'toggle_snapshot_collapse', payload: { snapshot_id: string, window_index: number, tab_index: number } }
    | { type: 'toggle_snapshot_window_collapse', payload: { snapshot_id: string, window_index: number } }
    ;

export type BrowserEvent =
    | { type: 'tab_created', payload: { tab: browser.Tabs.Tab } }
    | { type: 'tab_removed', payload: { tid: TabId, remove_info: browser.Tabs.OnRemovedRemoveInfoType } }
    | { type: 'tab_updated', payload: { tid: TabId, change_info: browser.Tabs.OnUpdatedChangeInfoType, tab: browser.Tabs.Tab } }
    | { type: 'tab_moved', payload: { tid: TabId, move_info: browser.Tabs.OnMovedMoveInfoType } }
    | { type: 'tab_attached', payload: { tid: TabId, attach_info: browser.Tabs.OnAttachedAttachInfoType } }
    | { type: 'tab_detached', payload: { tid: TabId, detach_info: browser.Tabs.OnDetachedDetachInfoType } }
    | { type: 'tab_activated', payload: { activated_info: browser.Tabs.OnActivatedActiveInfoType } }
    | { type: 'window_created', payload: { win: browser.Windows.Window } }
    | { type: 'window_removed', payload: { wid: WindowId } }
    | { type: 'window_focus_changed', payload: { wid: WindowId } }
    | { type: 'sessions_changed', payload: {} }
    ;

export type AppEffect =
    | { type: 'effects', payload: { effects: AppEffect[] } }
    | { type: 'node_removed', payload: { node: Node, browser_id: BrowserId } }
    | { type: 'tab_created', payload: { bid: BruhId, wbid: BruhId, index: number } }
    | { type: 'tab_focused', payload: { bid: BruhId } }
    | { type: 'tabs_moved', payload: { tbids: BruhId[], wbid: BruhId, index: number } }
    | { type: 'tabs_discarded', payload: { tbids: BruhId[], wbid: BruhId } }
    | { type: 'tabs_reloaded', payload: { tbids: BruhId[], wbid: BruhId } }
    | { type: 'tabs_closed', payload: { tids: TabId[] } }
    | { type: 'window_created', payload: { wbid: BruhId } }
    | { type: 'window_closed', payload: { wid: WindowId } }
    | { type: 'write_window_session', payload: { wid: WindowId, bid: BruhId } }
    | { type: 'write_tab_session', payload: { tid: TabId, bid: BruhId } }
    | { type: 'update_tab_url', payload: { tid: TabId, url: string } }
    | { type: 'save_config', payload: {} }
    | { type: 'save_snapshots', payload: {} }
    | { type: 'save_state', payload: {} }
    ;

export type StateEffect =
    | { type: 'effects', payload: { effects: StateEffect[] } }
    | Extract<BrowserEvent, { type: 'window_removed' }>
    | { type: 'sessions_changed', payload: { sessions: Awaited<ReturnType<typeof browser.sessions.getRecentlyClosed>> } }
    | Extract<BrowserEvent, { type: 'tab_activated' }>
    | Extract<BrowserEvent, { type: 'tab_attached' }>
    | Extract<BrowserEvent, { type: 'tab_detached' }>
    | Extract<BrowserEvent, { type: 'tab_moved' }>
    | Extract<BrowserEvent, { type: 'tab_removed' }>
    | { type: 'window_created', payload: { old_wbid: BruhId | undefined, wid: WindowId } }
    | { type: 'upate_tab_info', payload: { tid: TabId, url: string | undefined, favIconUrl: string | undefined, title: string | undefined, discarded: boolean | undefined } }
    | {
        type: 'tab_created', payload: {
            old_wbid: BruhId | undefined,
            old_tbid: BruhId | undefined,

            wid: WindowId,
            tid: TabId,
            opener_tab_id: TabId | undefined,
            index: number | undefined,
            url: string | undefined,
            favIconUrl: string | undefined,
            title: string | undefined,
            discarded: boolean | undefined,
        }
    }
    | { type: 'register_tab', payload: { tid: TabId, bid: BruhId } }
    | { type: 'register_window', payload: { wid: WindowId, bid: BruhId } }
    ;

export type StateEvent =
    | { type: 'state_effect', payload: StateEffect }
    | { type: 'state_action', payload: StateAction }
    ;

export type AppEvent =
    | { type: 'browser_event', payload: BrowserEvent }
    | { type: 'app_request', payload: { message: AppRequest, port: browser.Runtime.Port } }
    | { type: 'state_action', payload: { message: StateAction, port: browser.Runtime.Port } }
    | { type: 'save_state', payload: {} }
    ;

export type BruhUiEvent =
    | { type: 'state_effect', payload: StateEffect }
    | { type: 'state_action', payload: StateAction }
    | { type: 'app_response', payload: AppResponse }
    | { type: 'logs', payload: { logs: utils.Log[] } }
    ;

export type ExtensionAction =
    | { type: 'app_request', payload: AppRequest }
    | { type: 'state_action', payload: StateAction }
    ;

export type BruhExport = {
    name?: string,
    timestamp: string, // Date converted to string
    windows: {
        name?: string,
        collapsed?: boolean,
        tabs: {
            url: string,
            title: string,
            parent_index: number | null,
            collapsed?: boolean,
        }[],
    }[],
};

export type SideberryExport = {
    id: string,
    time: number,
    dateStr: string,
    timeStr: string,
    sizeStr: string,
    winCount: number,
    tabsCount: number,
    containers: Record<string, {
        id: string,
        cookieStoreId: string,
        name: string,
        icon: string,
        color: string,
        colorCode: string,
        proxified: boolean,
        proxy: unknown | null, // ?
        reopenRulesActive: boolean,
        reopenRules: unknown[],
        userAgentActive: boolean,
        userAgent: string,
    }>,
    sidebar: {
        nav: string[],
        panels: Record<string, {
            type: number,
            id: string,
            name: string,
            color: string,
            iconSVG: string,
            iconIMGSrc: string,
            iconIMG: string,
            lockedPanel: boolean,
            skipOnSwitching: boolean,
            noEmpty: boolean,
            newTabCtx: unknown,
            dropTabCtx: unknown,
            moveRules: unknown[],
            moveExcludedTo: number,
            bookmarksFolderId: number,
            newTabBtns: unknown[],
            srcPanelConfig: null | unknown,
        }>,
    },
    tabs: {
        url: string,
        title: string,
        panelId: string,
        lvl?: number,
        folded?: boolean
    }[][][],
    windows: {
        id: number,
        tabsLen: number,
        panels: {
            id: string,
            tabsLen: number,
            name?: string,
            iconSVG?: string,
            iconIMG?: string,
            color?: string,
            tabs: {
                url: string,
                title: string,
                panelId: string,
                id: number,
                domain: string,
                iconSVG: string,
                sel: boolean,
                lvl?: number,
            }[]
        }[],
    }[],
};
