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
    sourceWindowId: number;
    movedTabIds: number[];
    parentMapSnapshot: Record<number, number | undefined>;
    collapsed: number[];
};

export type DropAction = 'above' | 'below' | 'inside' | 'root';

export type WindowState = {
    parentMap: Map<number, number>;
    collapsedNodes: Set<number>;
    tabs: browser.Tabs.Tab[];
    tree: TabTree;
    tabsById: Map<number, browser.Tabs.Tab>;
    rootIds: number[];
};

export type UiStateForRender = {
    tree: TabTree;
    tabsById: Map<number, browser.Tabs.Tab>;
    rootIds: number[];
    collapsedNodes: Set<number>;
};

type ActionPayloads = {
    'GET_STATE': { windowId: number };
    'FOCUS_TAB': { tabId: number };
    'CLOSE_SUBTREE': { tabId: number };
    'TOGGLE_COLLAPSE': { nodeId: number; windowId: number };
    'HANDLE_DROP': { dragData: DragData; targetTabId: number; action: DropAction; windowId: number };
    'DUPLICATE_TAB_SMART': { tabId: number };
    'UNLOAD_TAB': { tabId: number };
    'UNLOAD_TREE': { tabId: number };
    'LOAD_TREE': { tabId: number };
    'MOVE_SUBTREE_TO_NEW_WINDOW': { rootTabId: number };
    'CREATE_TAB': { windowId: number };
    'APPLY_PENDING_DATA': { dragData: DragData; windowId: number };
};

export type Message<T extends keyof ActionPayloads> = {
    type: T;
    payload: ActionPayloads[T];
};

export type BackgroundRequest =
    | Message<'GET_STATE'>
    | Message<'FOCUS_TAB'>
    | Message<'CLOSE_SUBTREE'>
    | Message<'TOGGLE_COLLAPSE'>
    | Message<'HANDLE_DROP'>
    | Message<'DUPLICATE_TAB_SMART'>
    | Message<'UNLOAD_TAB'>
    | Message<'UNLOAD_TREE'>
    | Message<'LOAD_TREE'>
    | Message<'MOVE_SUBTREE_TO_NEW_WINDOW'>
    | Message<'CREATE_TAB'>
    | Message<'APPLY_PENDING_DATA'>;


type ResponsePayloads = {
    'STATE_UPDATE': { state: UiStateForRender };
    'RENDER': { windowId: number };
};

export type BackgroundResponse =
    | { type: 'STATE_UPDATE'; payload: ResponsePayloads['STATE_UPDATE'] }
    | { type: 'RENDER'; payload: ResponsePayloads['RENDER'] };
