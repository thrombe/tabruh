import browser from 'webextension-polyfill';

export type TabNode = {
    bid: number;
    title: string;
    url: string;
    favIconUrl?: string;
    parentId?: number;
    children: number[];
    isGroup?: boolean;
    customTitle?: string;
};

export type TabTree = Map<number, TabNode>;

export type DragType = 'tabs' | 'window';

export type DragData = {
    type: DragType;
    sourceStateId: number;
    draggedTabId?: number;
    movedTabIds: number[];
    parentMapSnapshot: Record<number, number | undefined>;
    collapsed: number[];
};

export type DropAction = 'above' | 'below' | 'inside' | 'root';

export type WindowState = {
    bid: number;
    name: string;
    windowId?: number;
    isClosed: boolean;
    creationTimestamp: number;
    closedTimestamp?: number;
    lastActiveTabId?: number;
    parentMap: Map<number, number>;
    collapsedNodes: Set<number>;
    tabs: browser.Tabs.Tab[];
    tree: TabTree;
    tabsById: Map<number, browser.Tabs.Tab>;
    rootIds: number[];
};

export type UiStateForRender = {
    id: number;
    name: string;
    isClosed: boolean;
    windowId?: number;
    creationTimestamp: number;
    tree: TabTree;
    tabsById: Map<number, browser.Tabs.Tab>;
    rootIds: number[];
    collapsedNodes: Set<number>;
};

type ActionPayloads = {
    'GET_STATE_FOR_WINDOW': { windowId: number };
    'GET_STATE_FOR_GROUP_VIEW': { nodeId: number };
    'GET_ALL_WINDOW_STATES': {};
    'FOCUS_TAB': { tabId: number };
    'CLOSE_SUBTREE': { tabId: number };
    'CLOSE_SINGLE_TAB': { tabId: number };
    'TOGGLE_COLLAPSE': { nodeId: number; stateId: number };
    'HANDLE_DROP': { dragData: DragData; targetTabId: number; action: DropAction; targetStateId: number };
    'DUPLICATE_TAB_SMART': { tabId: number };
    'UNLOAD_TAB': { tabId: number };
    'UNLOAD_TREE': { tabId: number };
    'LOAD_TREE': { tabId: number };
    'MOVE_SUBTREE_TO_NEW_WINDOW': { rootTabId: number };
    'CREATE_TAB': { windowId: number };
    'CREATE_TAB_FROM_URL': { url: string; windowId: number; index?: number; parentId?: number };
    'APPLY_PENDING_DATA': { dragData: DragData; targetStateId: number };
    'RENAME_WINDOW': { stateId: number; newName: string };
    'CLOSE_WINDOW': { stateId: number };
    'RESTORE_WINDOW': { stateId: number };
    'DELETE_WINDOW_STATE': { stateId: number };
    'FLATTEN_IMMEDIATE': { tabId: number };
    'FLATTEN_TREE': { tabId: number };
    'CREATE_GROUP': { windowId: number, parentId?: number, index?: number };
    'RENAME_NODE': { nodeId: number, newName: string };
    'POP_OUT_GROUP': { tabId: number };
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
    | Message<'APPLY_PENDING_DATA'>
    | Message<'RENAME_WINDOW'>
    | Message<'CLOSE_WINDOW'>
    | Message<'RESTORE_WINDOW'>
    | Message<'DELETE_WINDOW_STATE'>
    | Message<'FLATTEN_IMMEDIATE'>
    | Message<'FLATTEN_TREE'>
    | Message<'CREATE_GROUP'>
    | Message<'RENAME_NODE'>
    | Message<'POP_OUT_GROUP'>;


type ResponsePayloads = {
    'STATE_UPDATE': { state: UiStateForRender; };
    'ALL_STATES_UPDATE': { states: UiStateForRender[] };
    'RENDER_ALL': {};
    'STATE_REMOVED': { stateId: string };
};

export type BackgroundResponse =
    | { type: 'STATE_UPDATE'; payload: ResponsePayloads['STATE_UPDATE'] }
    | { type: 'ALL_STATES_UPDATE'; payload: ResponsePayloads['ALL_STATES_UPDATE'] }
    | { type: 'RENDER_ALL'; payload: ResponsePayloads['RENDER_ALL'] }
    | { type: 'STATE_REMOVED'; payload: ResponsePayloads['STATE_REMOVED'] };
