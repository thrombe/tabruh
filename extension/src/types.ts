import browser from 'webextension-polyfill';
import * as utils from './utils';

export type TabId = number;
export type WindowId = number;
export type BrowserId = TabId | WindowId;

export type BruhId = number;

export type Node = {
    id: BruhId
    title: string;
} & ({
    type: "tab",
    tid: TabId,
    url: string;
    favIconUrl?: string;
    parentId: BruhId;
    collapsed: boolean,
} | {
    type: "group",
    tid: TabId,
    url: string,
    favIconUrl?: string;
    parentId: BruhId,
    collapsed: boolean,
} | {
    type: "window",
    wid: WindowId,
});

export type BruhTab = {
    id: BruhId,
    tid: TabId,
    wid: WindowId,
    index: number,
    discarded: boolean,
    active: boolean,
    closed: boolean,
};

export type BruhWindow = {
    id: BruhId,
    wid: WindowId,
    closed: boolean,
    tabIds: TabId[],
};

export type NodeTree = Map<BruhId, Node>;

export type DragType = 'tabs' | 'window';
export type DropAction = 'above' | 'below' | 'inside' | 'root';

export type DragData = {
    type: DragType;
    sourceWindowId: WindowId;
    draggedNodeId: BruhId;
    movedNodeIds: BruhId[];
};

export type UiStateForRender = {
    id: BruhId;
    windowId: WindowId;
    name: string;
    isCustomNamed: boolean;
    isClosed: boolean;
    generation: number;
    tree: Map<BruhId, UiNode>;
    tabsById: Map<TabId, BruhTab>;
    rootIds: BruhId[];
};

export type UiNode = {
    id: BruhId;
    tid?: TabId;
    tab_index: number;
    title: string;
    url?: string;
    favIconUrl?: string;
    isGroup: boolean;
    isDiscarded: boolean;
    isActive: boolean;
    isCollapsed: boolean;
    children: BruhId[];
};

type ActionPayloads = {
    'GET_STATE_FOR_WINDOW': { windowId: WindowId };
    'GET_STATE_FOR_GROUP_VIEW': { nodeId: BruhId };
    'GET_ALL_WINDOW_STATES': {};
    'FOCUS_TAB': { nodeId: BruhId };
    'CLOSE_SUBTREE': { nodeId: BruhId };
    'CLOSE_SINGLE_TAB': { nodeId: BruhId };
    'TOGGLE_COLLAPSE': { nodeId: BruhId };
    'HANDLE_DROP': { dragData: DragData; targetNodeId: BruhId; action: DropAction; targetWindowId: WindowId };
    'DUPLICATE_TAB_SMART': { nodeId: BruhId, tabIndex?: number };
    'UNLOAD_TAB': { nodeId: BruhId };
    'UNLOAD_TREE': { nodeId: BruhId };
    'LOAD_TREE': { nodeId: BruhId };
    'MOVE_SUBTREE_TO_NEW_WINDOW': { rootNodeId: BruhId };
    'CREATE_TAB': { windowId: WindowId, parentId: BruhId };
    'CREATE_TAB_FROM_URL': { url: string; windowId: WindowId; parentId: BruhId };
    'RENAME_WINDOW': { windowId: WindowId; newName: string };
    'CLOSE_WINDOW': { windowId: WindowId };
    'RESTORE_WINDOW': { windowId: WindowId };
    'DELETE_WINDOW_STATE': { windowId: WindowId };
    'FLATTEN_IMMEDIATE': { nodeId: BruhId };
    'FLATTEN_TREE': { nodeId: BruhId };
    'CREATE_GROUP': { windowId: WindowId, parentId: BruhId };
    'RENAME_NODE': { nodeId: BruhId, newName: string };
};


export type Message<T extends keyof ActionPayloads> = {
    type: T;
    payload: ActionPayloads[T];
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
    'STATE_UPDATE': { state: UiStateForRender; };
    'ALL_STATES_UPDATE': { states: UiStateForRender[] };
    'RENDER_ALL': {};
};

export type BackgroundResponse =
    | { type: 'STATE_UPDATE'; payload: ResponsePayloads['STATE_UPDATE'] }
    | { type: 'ALL_STATES_UPDATE'; payload: ResponsePayloads['ALL_STATES_UPDATE'] }
    | { type: 'RENDER_ALL'; payload: ResponsePayloads['RENDER_ALL'] }

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
