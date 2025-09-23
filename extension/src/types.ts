import browser from 'webextension-polyfill';

export type TabNode = {
    id: number;
    title: string;
    url: string;
    favIconUrl?: string;
    parentId?: number;
    children: number[];
};

export type TabTree = Map<number, TabNode>;

export type DragData = {
    draggedTabId: number;
    sourceGroupId: string;
    movedTabIds: number[];
    parentMapSnapshot: Record<number, number | undefined>;
    collapsed: number[];
};

export type DropAction = 'above' | 'below' | 'inside' | 'root';

export type GroupState = {
    id: string;
    name: string;
    windowId?: number;
    isClosed: boolean;
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
    id: string;
    name: string;
    isClosed: boolean;
    tree: TabTree;
    tabsById: Map<number, browser.Tabs.Tab>;
    rootIds: number[];
    collapsedNodes: Set<number>;
};

type ActionPayloads = {
    'GET_STATE_FOR_WINDOW': { windowId: number };
    'GET_ALL_GROUPS': {};
    'FOCUS_TAB': { tabId: number };
    'CLOSE_SUBTREE': { tabId: number };
    'CLOSE_SINGLE_TAB': { tabId: number };
    'TOGGLE_COLLAPSE': { nodeId: number; groupId: string };
    'HANDLE_DROP': { dragData: DragData; targetTabId: number; action: DropAction; targetGroupId: string };
    'DUPLICATE_TAB_SMART': { tabId: number };
    'UNLOAD_TAB': { tabId: number };
    'UNLOAD_TREE': { tabId: number };
    'LOAD_TREE': { tabId: number };
    'MOVE_SUBTREE_TO_NEW_WINDOW': { rootTabId: number };
    'CREATE_TAB': { windowId: number };
    'CREATE_TAB_FROM_URL': { url: string; windowId: number; index?: number; parentId?: number };
    'APPLY_PENDING_DATA': { dragData: DragData; targetGroupId: string };
    'RENAME_GROUP': { groupId: string; newName: string };
    'CLOSE_GROUP': { groupId: string };
    'RESTORE_GROUP': { groupId: string };
    'DELETE_GROUP': { groupId: string };
};

export type Message<T extends keyof ActionPayloads> = {
    type: T;
    payload: ActionPayloads[T];
};

export type BackgroundRequest =
    | Message<'GET_STATE_FOR_WINDOW'>
    | Message<'GET_ALL_GROUPS'>
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
    | Message<'RENAME_GROUP'>
    | Message<'CLOSE_GROUP'>
    | Message<'RESTORE_GROUP'>
    | Message<'DELETE_GROUP'>;

type ResponsePayloads = {
    'STATE_UPDATE': { state: UiStateForRender; };
    'ALL_GROUPS_UPDATE': { groups: UiStateForRender[] };
    'RENDER_ALL': {};
    'GROUP_REMOVED': { groupId: string };
};

export type BackgroundResponse =
    | { type: 'STATE_UPDATE'; payload: ResponsePayloads['STATE_UPDATE'] }
    | { type: 'ALL_GROUPS_UPDATE'; payload: ResponsePayloads['ALL_GROUPS_UPDATE'] }
    | { type: 'RENDER_ALL'; payload: ResponsePayloads['RENDER_ALL'] }
    | { type: 'GROUP_REMOVED'; payload: ResponsePayloads['GROUP_REMOVED'] };
