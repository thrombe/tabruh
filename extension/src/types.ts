import browser from 'webextension-polyfill';
import * as utils from './utils';

export type TabId = utils.Branded<number, "TabId">;
export type WindowId = utils.Branded<number, "WindowId">;
export type BrowserId = TabId | WindowId;

export type BruhId = utils.Branded<number, "BruhId">;
export type HierarchyGenerationId = utils.Branded<number, "HgId">;

export type StorageState = {
    bruh_session_key: string,
    bruhid: BruhId,
    hgid: HierarchyGenerationId,
    nodes: Record<string, NodeStorageData>,
    browser_restore_cache: Record<string, NodeStorageData>,
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

export type DragData = {
    type: DragType,
    sourceWindowId: BruhId,
    draggedNodeId: BruhId,
    movedNodeIds: BruhId[],
};

export type UiStateForRender = {
    id: BruhId,
    wbid: BruhId,
    name: string,
    is_custom_named: boolean,
    is_closed: boolean,
    generation: number,
    tree: Map<BruhId, UiNode>,
    root_bids: BruhId[],
};

export type UiNode = {
    id: BruhId,
    tid?: TabId,
    tab_index: number,
    title: string,
    url?: string,
    favIconUrl?: string,
    isGroup: boolean,
    isDiscarded: boolean,
    isActive: boolean,
    isCollapsed: boolean,
    children: BruhId[],
};

export type BackgroundRequest =
    | { type: 'get_state_for_window', payload: { wid: WindowId } }
    | { type: 'get_all_window_states', payload: {} }

    | { type: 'get_state_for_group_view', payload: { bid: BruhId } }
    | { type: 'focus_tab', payload: { bid: BruhId } }
    | { type: 'close_tabs', payload: { bid: BruhId, recursive: boolean } }
    | { type: 'toggle_collapse', payload: { bid: BruhId } }
    | { type: 'handle_drop', payload: { drag_data: DragData, target_bid: BruhId, action: DropAction } }
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
    ;

export type BackgroundResponse =
    | { type: 'state_update', payload: { state: UiStateForRender, } }
    | { type: 'all_states_update', payload: { states: UiStateForRender[] } }
    | { type: 'render_all', payload: {} }
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

export type BrowserEffect =
    | { type: 'effects', payload: { effects: BrowserEffect[] } }
    | { type: 'node_removed', payload: { node: Node, browser_id: BrowserId } }
    | { type: 'tab_created', payload: { bid: BruhId, wbid: BruhId, index: number } }
    | { type: 'tab_focused', payload: { bid: BruhId } }
    | { type: 'tabs_moved', payload: { tbids: BruhId[], wbid: BruhId, index: number } }
    | { type: 'tabs_discarded', payload: { tbids: BruhId[], wbid: BruhId } }
    | { type: 'tabs_reloaded', payload: { tbids: BruhId[], wbid: BruhId } }
    | { type: 'tabs_closed', payload: { tids: TabId[] } }
    | { type: 'window_created', payload: { wbid: BruhId } }
    | { type: 'window_closed', payload: { wbid: BruhId } }
    ;

export type PortMessageEvent = {
    type: 'port_message',
    payload: { message: BackgroundRequest, port: browser.Runtime.Port }
};

export type StateManagerEvent = BrowserEvent | PortMessageEvent;
