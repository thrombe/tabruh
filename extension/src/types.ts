import browser from 'webextension-polyfill';
import * as utils from './utils';

export type TabId = utils.Branded<number, "TabId">;
export type WindowId = utils.Branded<number, "WindowId">;
export type BrowserId = TabId | WindowId;

export type BruhId = utils.Branded<number, "BruhId">;
export type HierarchyGenerationId = utils.Branded<number, "HgId">;

export type StorageState = {
    bruhid: BruhId,
    hgid: HierarchyGenerationId,
    nodes: Record<string, NodeStorageData>,
    browserRestoreCache: Record<string, NodeStorageData>,
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
} | {
    type: "group",
    groupAttrs: GroupName,
    collapsed: boolean,
} | {
    type: "window",
    groupAttrs: GroupName,
    tab_bids: BruhId[],
});

export type GroupName = {
    name: string;
    // use to sort windows on screen (persists when window <-> group conversions)
    name_generation: number,
    is_name_custom: number,
};

export type Node = {
    bid: BruhId,
    wbid: BruhId,
    hgid: HierarchyGenerationId,
} & ({
    type: "tab",
    parentId: BruhId,
    collapsed: boolean,

    discarded: boolean,

    url: string,
    title: string,
    favIconUrl: string,
} | {
    type: "group",
    parentId: BruhId,
    collapsed: boolean,

    discarded: boolean,

    name: GroupName,
} | {
    type: "window",
    parentId: BruhId & 0,
    collapsed: false,

    active: BruhId,
    tabIds: BruhId[],
    isArchivedPristine?: boolean,
    closed: boolean,

    name: GroupName,
});

export type TabData = Extract<Node, { type: "tab" | "group" }>;
export type UrlTabData = Extract<Node, { type: "tab" }>;
export type GroupTabData = Extract<Node, { type: "group" }>;
export type WindowData = Extract<Node, { type: "window" }>;

export type NodeTree = Map<BruhId, Node>;

export type DragType = 'tabs' | 'window';
export type DropAction = 'above' | 'below' | 'inside';

export type DragData = {
    type: DragType,
    sourceWindowId: WindowId,
    draggedNodeId: BruhId,
    movedNodeIds: BruhId[],
};

export type UiStateForRender = {
    id: BruhId,
    wbid: BruhId,
    name: string,
    isCustomNamed: boolean,
    isClosed: boolean,
    generation: number,
    tree: Map<BruhId, UiNode>,
    rootIds: BruhId[],
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
    | { type: 'close_subtree', payload: { bid: BruhId } }
    | { type: 'close_single_tab', payload: { bid: BruhId } }
    | { type: 'toggle_collapse', payload: { bid: BruhId } }
    | { type: 'handle_drop', payload: { drag_data: DragData, target_bid: BruhId, action: DropAction } }
    | { type: 'duplicate_tab_smart', payload: { bid: BruhId } }
    | { type: 'unload_tab', payload: { bid: BruhId } }
    | { type: 'unload_tree', payload: { bid: BruhId } }
    | { type: 'load_tree', payload: { bid: BruhId } }
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

export type PortMessageEvent = {
    type: 'port_message',
    payload: { message: BackgroundRequest, port: browser.Runtime.Port }
};

export type StateManagerEvent = BrowserEvent | PortMessageEvent;
