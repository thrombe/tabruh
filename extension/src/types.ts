import browser from 'webextension-polyfill';
import * as utils from './utils';

export type TabId = utils.Branded<number, "TabId">;
export type WindowId = utils.Branded<number, "WindowId">;
export type BrowserId = TabId | WindowId;

export type BruhId = utils.Branded<number, "BruhId">;
export type HierarchyGenerationId = utils.Branded<number, "HgId">;

export type GroupAttrs = { name: string; generation: number; isCustomNamed: boolean; };

export type NodeStorageData = {
    bruhId: BruhId,
    parentId: BruhId,
    windowBid: BruhId,
    ancestorIds: BruhId[],
    childrenIds: BruhId[],
    // ids of all the things this tab comes after in the same group.
    // necessary to restore the exact position of tabs.
    comesAfterIds: BruhId[],
    hgid: HierarchyGenerationId,
    cache_hgid: HierarchyGenerationId,
    collapsed: boolean,
} & ({
    type: "tab",
    url: string,
    title: string,
} | {
    type: "group",
    groupAttrs: GroupAttrs,
} | {
    type: "window",
    groupAttrs: GroupAttrs,
});

export type Node = {
    id: BruhId,
    hgid: HierarchyGenerationId,
} & ({
    parentId: BruhId,
    collapsed: boolean,
    type: "tab" | "group",
    tid: TabId,
} | {
    parentId: BruhId & 0,
    collapsed: false,
    type: "window",
    wid: WindowId,
});

export type BruhTab = {
    id: BruhId,
    tid: TabId,
    wid: WindowId,
    index: number,
    url: string,
    title: string,
    favIconUrl?: string,
    discarded: boolean,
    active: boolean,
    closed: boolean,
};

export type BruhWindow = {
    id: BruhId,
    wid: WindowId,
    tabIds: TabId[],
    closed: boolean,
    isArchivedPristine?: boolean,
};

export type NodeTree = Map<BruhId, Node>;

export type DragType = 'tabs' | 'window';
export type DropAction = 'above' | 'below' | 'inside' | 'root';

export type DragData = {
    type: DragType,
    sourceWindowId: WindowId,
    draggedNodeId: BruhId,
    movedNodeIds: BruhId[],
};

export type UiStateForRender = {
    id: BruhId,
    windowId: WindowId,
    name: string,
    isCustomNamed: boolean,
    isClosed: boolean,
    generation: number,
    tree: Map<BruhId, UiNode>,
    tabsById: Map<TabId, BruhTab>,
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

type ActionPayloads = {
    'GET_STATE_FOR_WINDOW': { windowId: WindowId },
    'GET_STATE_FOR_GROUP_VIEW': { nodeId: BruhId },
    'GET_ALL_WINDOW_STATES': {},
    'FOCUS_TAB': { nodeId: BruhId },
    'CLOSE_SUBTREE': { nodeId: BruhId },
    'CLOSE_SINGLE_TAB': { nodeId: BruhId },
    'TOGGLE_COLLAPSE': { nodeId: BruhId },
    'HANDLE_DROP': { dragData: DragData, targetNodeId: BruhId, action: DropAction, targetWindowId: WindowId },
    'DUPLICATE_TAB_SMART': { nodeId: BruhId },
    'UNLOAD_TAB': { nodeId: BruhId },
    'UNLOAD_TREE': { nodeId: BruhId },
    'LOAD_TREE': { nodeId: BruhId },
    'MOVE_SUBTREE_TO_NEW_WINDOW': { rootNodeId: BruhId },
    'CREATE_TAB': { windowId: WindowId, parentId: BruhId },
    'CREATE_TAB_FROM_URL': { url: string, windowId: WindowId, parentId: BruhId },
    'RENAME_WINDOW': { windowId: WindowId, newName: string },
    'CLOSE_WINDOW': { windowId: WindowId },
    'RESTORE_WINDOW': { windowId: WindowId },
    'DELETE_WINDOW_STATE': { windowId: WindowId },
    'FLATTEN_IMMEDIATE': { nodeId: BruhId },
    'FLATTEN_TREE': { nodeId: BruhId },
    'CREATE_GROUP': { windowId: WindowId, parentId: BruhId },
    'RENAME_NODE': { nodeId: BruhId, newName: string },
};


export type Message<T extends keyof ActionPayloads> = {
    type: T,
    payload: ActionPayloads[T],
};

export type BackgroundRequest =
    | Message<'GET_STATE_FOR_WINDOW'>
    | Message<'GET_STATE_FOR_GROUP_VIEW'>
    | Message<'GET_ALL_WINDOW_STATES'>
    | Message<'FOCUS_TAB'>
    | Message<'CLOSE_SUBTREE'>
    | Message<'CLOSE_SINGLE_TAB'>
    | Message<'TOGGLE_COLLAPSE'>
    | Message<'HANDLE_DROP'>
    | Message<'DUPLICATE_TAB_SMART'>
    | Message<'UNLOAD_TAB'>
    | Message<'UNLOAD_TREE'>
    | Message<'LOAD_TREE'>
    | Message<'MOVE_SUBTREE_TO_NEW_WINDOW'>
    | Message<'CREATE_TAB'>
    | Message<'CREATE_TAB_FROM_URL'>
    | Message<'RENAME_WINDOW'>
    | Message<'CLOSE_WINDOW'>
    | Message<'RESTORE_WINDOW'>
    | Message<'DELETE_WINDOW_STATE'>
    | Message<'FLATTEN_IMMEDIATE'>
    | Message<'FLATTEN_TREE'>
    | Message<'CREATE_GROUP'>
    | Message<'RENAME_NODE'>;


type ResponsePayloads = {
    'STATE_UPDATE': { state: UiStateForRender, },
    'ALL_STATES_UPDATE': { states: UiStateForRender[] },
    'RENDER_ALL': {},
};

export type BackgroundResponse =
    | { type: 'STATE_UPDATE', payload: ResponsePayloads['STATE_UPDATE'] }
    | { type: 'ALL_STATES_UPDATE', payload: ResponsePayloads['ALL_STATES_UPDATE'] }
    | { type: 'RENDER_ALL', payload: ResponsePayloads['RENDER_ALL'] };

export type BrowserEvent =
    | { type: 'tabCreated', payload: browser.Tabs.Tab }
    | { type: 'tabRemoved', payload: { tabId: TabId, removeInfo: browser.Tabs.OnRemovedRemoveInfoType } }
    | { type: 'tabUpdated', payload: { tabId: TabId, changeInfo: browser.Tabs.OnUpdatedChangeInfoType, tab: browser.Tabs.Tab } }
    | { type: 'tabMoved', payload: { tabId: TabId, moveInfo: browser.Tabs.OnMovedMoveInfoType } }
    | { type: 'tabAttached', payload: { tabId: TabId, attachInfo: browser.Tabs.OnAttachedAttachInfoType } }
    | { type: 'tabDetached', payload: { tabId: TabId, detachInfo: browser.Tabs.OnDetachedDetachInfoType } }
    | { type: 'tabActivated', payload: browser.Tabs.OnActivatedActiveInfoType }
    | { type: 'windowCreated', payload: browser.Windows.Window }
    | { type: 'windowRemoved', payload: WindowId }
    | { type: 'windowFocusChanged', payload: WindowId };

export type PortMessageEvent = {
    type: 'portMessage',
    payload: {
        message: BackgroundRequest,
        port: browser.Runtime.Port
    }
};

export type StateManagerEvent = BrowserEvent | PortMessageEvent;
