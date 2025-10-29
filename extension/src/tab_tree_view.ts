import './tab_tree_view.css';
import browser from 'webextension-polyfill';
import * as svg from './svg';
import { State } from './state';
import * as utils from './utils';
import type {
    DragData,
    AppRequest,
    DropAction,
    BruhId,
    WindowId,
    SnapshotDragData,
    ExtensionAction,
    StateAction,
    Node,
    BruhExport,
} from './types';

const DEFAULT_FAVICON_URL = `data:image/svg+xml;base64,${btoa(svg.default_favicon)}`;

type RenderOptions = {
    is_read_only?: boolean,
    snapshot_id?: string,
    window_index?: number,
};

export class TabTreeView {
    private container: HTMLElement;
    private port: browser.Runtime.Port;
    private currentDragData: DragData | null = null;
    private treeType: "sidebar" | "overview" | "snapshot";
    private viewType: 'window' | 'group';
    private currentWindowId?: WindowId;

    private currentLiveData?: { state: State, rootId: BruhId, options: RenderOptions };
    private currentSnapshotData?: { window: BruhExport['windows'][number], snapshotId: string, windowIndex: number };

    constructor(
        container: HTMLElement,
        port: browser.Runtime.Port,
        treeType: "sidebar" | "overview" | "snapshot",
        viewType: 'window' | 'group' = 'window',
        currentWindowId?: WindowId,
    ) {
        this.container = container;
        this.port = port;
        this.treeType = treeType;
        this.viewType = viewType;
        this.currentWindowId = currentWindowId;
        this.container.classList.add('tab-tree-view-container');
    }

    private sendRequest(msg: AppRequest) {
        this.sendMessage({ type: 'app_request', payload: msg })
    }

    private sendAction(msg: StateAction) {
        this.sendMessage({ type: 'state_action', payload: msg })
    }

    private sendMessage(message: ExtensionAction) {
        try {
            this.port.postMessage(message);
        } catch (e) {
            console.error("Could not send message to background script.", e);
        }
    }

    public render(state: State, rootId: BruhId, options: RenderOptions = {}) {
        this.currentLiveData = { state, rootId, options };
        this.currentSnapshotData = undefined;
        this.container.innerHTML = '';

        const rootNode = state.get_node(rootId);
        const is_closed = state.is_node_closed(rootId);

        if (is_closed && this.treeType !== "snapshot") {
            this.container.classList.add('closed-group');
        } else {
            this.container.classList.remove('closed-group');
        }

        this.container.appendChild(this.renderHeader(state, rootNode, is_closed, options));

        if (rootNode.collapsed && this.treeType !== 'sidebar') return;

        const treeContainer = document.createElement('div');
        treeContainer.className = 'tab-tree-scroll-container';

        const rootContainer = document.createElement('div');
        rootContainer.className = 'flex flex-col';

        const childrenMap = new Map<BruhId, BruhId[]>();
        const window = state.get_window(rootNode.wbid);
        for (const tbid of window.tab_bids) {
            const tab = state.get_tab(tbid);
            if (!childrenMap.has(tab.parent_bid)) {
                childrenMap.set(tab.parent_bid, []);
            }
            childrenMap.get(tab.parent_bid)!.push(tbid);
        }

        const rootChildren = childrenMap.get(rootId) || [];
        for (const childId of rootChildren) {
            const nodeElement = this.renderNode(childId, state, childrenMap, options);
            rootContainer.appendChild(nodeElement);
        }
        treeContainer.appendChild(rootContainer);

        treeContainer.appendChild(this.renderAddButton(state, rootId));

        this.container.appendChild(treeContainer);
    }

    public renderSnapshot(snapshotWindow: BruhExport['windows'][number], snapshotId: string, windowIndex: number) {
        this.currentSnapshotData = { window: snapshotWindow, snapshotId, windowIndex };
        this.currentLiveData = undefined;
        this.container.innerHTML = '';
        this.container.classList.remove('closed-group');

        this.container.appendChild(this.renderSnapshotHeader(snapshotWindow, snapshotId, windowIndex));

        if (snapshotWindow.collapsed) return;

        const treeContainer = document.createElement('div');
        treeContainer.className = 'tab-tree-scroll-container';

        const rootContainer = document.createElement('div');
        rootContainer.className = 'flex flex-col';

        const childrenMap = new Map<number | null, number[]>();
        snapshotWindow.tabs.forEach((tab, index) => {
            const parentIndex = tab.parent_index;
            if (!childrenMap.has(parentIndex)) {
                childrenMap.set(parentIndex, []);
            }
            childrenMap.get(parentIndex)!.push(index);
        });

        const rootIndices = childrenMap.get(null) || [];
        for (const tabIndex of rootIndices) {
            rootContainer.appendChild(this.renderSnapshotNode(tabIndex, snapshotWindow, snapshotId, windowIndex, childrenMap));
        }

        treeContainer.appendChild(rootContainer);
        this.container.appendChild(treeContainer);
    }

    private is_group_tab_snapshot(url: string | undefined): boolean {
        if (!url) return false;
        try {
            const parsedUrl = new URL(url);
            return parsedUrl.protocol === 'moz-extension:' &&
                parsedUrl.pathname.endsWith('/overview.html') &&
                parsedUrl.searchParams.get('view') === 'group';
        } catch (e) {
            return false;
        }
    }

    private getNodeSubtreeIds(rootId: BruhId, state: State): BruhId[] {
        return state.get_subtree(rootId);
    }

    private countAllDescendants(nodeId: BruhId, state: State): number {
        return state.get_subtree(nodeId).length - 1;
    }

    private getUrlFromDataTransfer(dataTransfer: DataTransfer): string | null {
        const url = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain');
        return url ? url.trim() : null;
    }

    private renderNode(nodeId: BruhId, state: State, childrenMap: Map<BruhId, BruhId[]>, options: RenderOptions): HTMLDivElement {
        const node = state.get_node(nodeId)!;
        const nodeWrapper = document.createElement('div');
        nodeWrapper.dataset.nodeId = String(node.bid);

        const nodeElement = document.createElement('div');
        nodeElement.className = 'tree-node';
        if (node.type === 'group') {
            nodeElement.classList.add('group-node');
        }
        nodeElement.draggable = true;

        const is_closed = state.is_node_closed(nodeId);
        const window = state.get_window(node.wbid);

        if ((node.type !== 'window' && node.discarded || is_closed) && this.treeType !== "snapshot") nodeElement.classList.add('discarded-tab');
        if (window.active === node.bid && this.treeType !== "snapshot") nodeElement.classList.add('focused-tab');

        if (this.treeType !== "snapshot") {
            if (!is_closed) {
                nodeElement.addEventListener('click', () => this.sendAction({ type: 'focus_tab', payload: { bid: node.bid } }));
            }
            nodeElement.addEventListener('mousedown', (event) => {
                if (event.button === 1) {
                    event.preventDefault();
                    this.sendAction({ type: 'close_tabs', payload: { bid: node.bid, recursive: false } });
                }
            });
        }
        nodeElement.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showContextMenu(e.clientX, e.clientY, node.bid); });

        nodeElement.addEventListener('dragstart', (event) => {
            event.stopPropagation();
            const movedNodeIds = this.getNodeSubtreeIds(node.bid, state);
            const dragData: DragData = {
                type: 'tabs',
                draggedNodeId: node.bid,
                sourceWindowId: node.wbid,
                movedNodeIds,
            };
            this.currentDragData = dragData;
            event.dataTransfer!.setData('application/json', JSON.stringify(dragData));
            event.dataTransfer!.effectAllowed = 'move';
            setTimeout(() => nodeElement.classList.add('dragging'), 0);
        });

        nodeElement.addEventListener('dragend', (event) => {
            nodeElement.classList.remove('dragging');
            const dragData = this.currentDragData;
            // Type guard to ensure we are dealing with a live drag
            if (event.dataTransfer?.dropEffect === 'none' && dragData && dragData.type !== 'snapshot_item') {
                this.sendAction({ type: 'move_subtree_to_new_window', payload: { bid: dragData.draggedNodeId } });
            }
            this.currentDragData = null;
        });


        nodeElement.addEventListener('dragover', (event) => {
            event.preventDefault();
            const types = event.dataTransfer?.types;
            if (!types || !(types.includes('application/json') || types.includes('text/uri-list') || types.includes('text/plain'))) {
                return;
            }

            if (types.includes('application/json')) {
                const dragDataStr = event.dataTransfer?.getData('application/json');
                if (dragDataStr) {
                    const dragData: DragData = JSON.parse(dragDataStr);
                    if (dragData.type === 'tabs' && dragData.movedNodeIds.includes(node.bid)) {
                        return;
                    }
                }
            }

            const rect = nodeElement.getBoundingClientRect();
            nodeElement.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
            const y = event.clientY - rect.top;
            if (y < rect.height * 0.25) {
                nodeElement.classList.add('drag-over-above');
                nodeElement.dataset.dropAction = 'above';
            } else if (y > rect.height * 0.75) {
                nodeElement.classList.add('drag-over-below');
                nodeElement.dataset.dropAction = 'below';
            } else {
                nodeElement.classList.add('drag-over-inside');
                nodeElement.dataset.dropAction = 'inside';
            }
            event.dataTransfer!.dropEffect = 'move';
        });

        nodeElement.addEventListener('dragleave', () => {
            nodeElement.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
            delete nodeElement.dataset.dropAction;
        });

        nodeElement.addEventListener('drop', async (event) => {
            event.preventDefault(); event.stopPropagation();
            nodeElement.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
            const action = nodeElement.dataset.dropAction as DropAction;
            delete nodeElement.dataset.dropAction;

            const dataTransfer = event.dataTransfer;
            if (!dataTransfer || !this.currentLiveData) return;

            const types = dataTransfer.types;
            if (types.includes('application/json')) {
                const dragDataStr = dataTransfer.getData('application/json');
                if (!dragDataStr) return;
                const dragData: DragData = JSON.parse(dragDataStr);
                this.currentDragData = null;

                if (dragData.type === 'snapshot_item') {
                    this.sendAction({ type: 'handle_snapshot_drop', payload: { drag_data: dragData, target_bid: node.bid, action } });
                } else if ((dragData.type === 'tabs' || dragData.type === 'window')) {
                    const movedNodeIds = state.get_subtree(dragData.draggedNodeId);
                    if (!movedNodeIds.includes(node.bid)) {
                        this.sendAction({ type: 'handle_drop', payload: { drag_data: dragData, target_bid: node.bid, action } });
                    }
                }
            } else if (types.includes('text/uri-list') || types.includes('text/plain')) {
                const url = this.getUrlFromDataTransfer(dataTransfer);
                if (!url) return;
                this.sendAction({ type: 'create_tab', payload: { url, parent_bid: node.bid, action } });
            }
        });

        const collapseContainer = document.createElement('div');
        collapseContainer.className = 'collapse-container';

        const children = childrenMap.get(nodeId) || [];
        if (children.length > 0) {
            const collapseButton = document.createElement('button');
            collapseButton.className = 'collapse-button';
            collapseButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="arrow-svg"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            collapseButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.sendAction({ type: 'toggle_collapse', payload: { bid: node.bid } });
            });

            if (node.collapsed) {
                collapseButton.classList.add('collapsed');
                const descendantCount = this.countAllDescendants(nodeId, state);
                if (descendantCount > 0) {
                    const countSpan = document.createElement('span');
                    countSpan.className = 'collapsed-count';
                    countSpan.textContent = String(descendantCount);
                    collapseButton.appendChild(countSpan);
                }
            }
            collapseContainer.appendChild(collapseButton);
        }

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'tree-node-content';
        const icon = document.createElement('img');
        if (node.type === 'group') {
            icon.src = `data:image/svg+xml;base64,${btoa(svg.icon_group)}`;
        } else if (node.type === 'tab') {
            icon.src = node.fav_icon_url || DEFAULT_FAVICON_URL;
            icon.onerror = () => { if (icon.src !== DEFAULT_FAVICON_URL) icon.src = DEFAULT_FAVICON_URL; };
        }
        icon.className = 'tree-node-icon';

        const title = document.createElement('span');
        title.className = 'tree-node-title';
        title.textContent = state.get_node_name(nodeId);
        contentWrapper.append(icon, title);

        const closeButton = document.createElement('button');
        closeButton.className = 'close-tab-button';
        closeButton.innerHTML = svg.icon_close;
        closeButton.addEventListener('click', (e) => { e.stopPropagation(); this.sendAction({ type: 'close_tabs', payload: { bid: node.bid, recursive: false } }); });
        nodeElement.append(collapseContainer, contentWrapper, closeButton);

        nodeWrapper.appendChild(nodeElement);

        if (children.length > 0 && !node.collapsed) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'children-container';
            for (const childId of children) {
                childrenContainer.appendChild(this.renderNode(childId, state, childrenMap, options));
            }
            nodeWrapper.appendChild(childrenContainer);
        }

        return nodeWrapper;
    }

    private renderHeader(state: State, rootNode: Node, is_closed: boolean, options: RenderOptions): HTMLDivElement {
        const header = document.createElement('div');
        header.className = 'tab-tree-header';
        header.draggable = true;

        header.addEventListener('dragstart', (event) => {
            event.stopPropagation();
            const movedNodeIds = Array.from(state.nodes.keys());
            const dragData: DragData = {
                type: 'window',
                draggedNodeId: rootNode.bid,
                sourceWindowId: rootNode.wbid,
                movedNodeIds,
            };

            this.currentDragData = dragData;
            event.dataTransfer!.setData('application/json', JSON.stringify(dragData));
            event.dataTransfer!.effectAllowed = 'move';
            setTimeout(() => this.container.classList.add('dragging'), 0);
        });

        header.addEventListener('dragend', () => {
            this.container.classList.remove('dragging');
            this.currentDragData = null;
        });

        const nameSpan = document.createElement('span');
        nameSpan.className = 'group-name';
        const nodeName = state.get_node_name(rootNode.bid);
        if (is_closed && this.treeType !== "snapshot") {
            nameSpan.textContent = `[Closed] ${nodeName}`;
        } else {
            nameSpan.textContent = nodeName;
        }

        nameSpan.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'group-name-input';
            input.value = nodeName;
            header.replaceChild(input, nameSpan);
            input.focus();
            input.select();
            const save = () => {
                if (input.value.trim()) {
                    this.sendAction({ type: 'rename_node', payload: { bid: rootNode.bid, new_name: input.value.trim() } });
                }
                header.replaceChild(nameSpan, input);
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') header.replaceChild(nameSpan, input);
            });
        });

        const menuButton = document.createElement('button');
        menuButton.className = 'group-menu-button';
        menuButton.innerHTML = '&#x22EE;';
        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showGroupContextMenu(e.clientX, e.clientY, rootNode.bid, is_closed);
        });

        header.append(nameSpan, menuButton);
        return header;
    }

    private renderSnapshotHeader(snapshotWindow: BruhExport['windows'][number], snapshotId: string, windowIndex: number): HTMLDivElement {
        const header = document.createElement('div');
        header.className = 'tab-tree-header';
        header.draggable = true;

        const collapseButton = document.createElement('button');
        collapseButton.className = 'group-menu-button header-collapse-button';
        collapseButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="arrow-svg"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        if (snapshotWindow.collapsed) {
            collapseButton.classList.add('collapsed');
        }
        collapseButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.sendAction({ type: 'toggle_snapshot_window_collapse', payload: { snapshot_id: snapshotId, window_index: windowIndex } });
        });

        header.addEventListener('dragstart', (event) => {
            event.stopPropagation();
            const dragData: SnapshotDragData = {
                type: 'snapshot_item',
                snapshotId: snapshotId,
                windowIndex: windowIndex,
                tabIndex: undefined, // undefined means whole window
            };
            this.currentDragData = dragData;
            event.dataTransfer!.setData('application/json', JSON.stringify(dragData));
            event.dataTransfer!.effectAllowed = 'move';
            setTimeout(() => this.container.classList.add('dragging'), 0);
        });

        header.addEventListener('dragend', () => {
            this.container.classList.remove('dragging');
            this.currentDragData = null;
        });

        const nameSpan = document.createElement('span');
        nameSpan.className = 'group-name';
        nameSpan.textContent = snapshotWindow.name ?? "Unnamed Window";

        const menuButton = document.createElement('button');
        menuButton.className = 'group-menu-button';
        menuButton.innerHTML = '&#x22EE;';
        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showGroupContextMenu(e.clientX, e.clientY, windowIndex as any, false);
        });

        header.append(collapseButton, nameSpan, menuButton);
        return header;
    }

    private renderSnapshotNode(tabIndex: number, snapshotWindow: BruhExport['windows'][number], snapshotId: string, windowIndex: number, childrenMap: Map<number | null, number[]>): HTMLDivElement {
        const tab = snapshotWindow.tabs[tabIndex]!;
        const nodeWrapper = document.createElement('div');
        nodeWrapper.dataset.nodeId = String(tabIndex);

        const nodeElement = document.createElement('div');
        nodeElement.className = 'tree-node';
        const isGroup = this.is_group_tab_snapshot(tab.url);
        if (isGroup) {
            nodeElement.classList.add('group-node');
        }
        nodeElement.draggable = true;

        nodeElement.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showContextMenu(e.clientX, e.clientY, tabIndex as any); });

        nodeElement.addEventListener('dragstart', (event) => {
            event.stopPropagation();
            const dragData: SnapshotDragData = {
                type: 'snapshot_item',
                snapshotId: snapshotId,
                windowIndex: windowIndex,
                tabIndex: tabIndex,
            };
            this.currentDragData = dragData;
            event.dataTransfer!.setData('application/json', JSON.stringify(dragData));
            event.dataTransfer!.effectAllowed = 'move';
            setTimeout(() => nodeElement.classList.add('dragging'), 0);
        });

        nodeElement.addEventListener('dragend', () => {
            nodeElement.classList.remove('dragging');
            this.currentDragData = null;
        });

        const collapseContainer = document.createElement('div');
        collapseContainer.className = 'collapse-container';

        const children = childrenMap.get(tabIndex) || [];
        if (children.length > 0) {
            const collapseButton = document.createElement('button');
            collapseButton.className = 'collapse-button';
            collapseButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="arrow-svg"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            collapseButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.sendAction({
                    type: 'toggle_snapshot_collapse',
                    payload: {
                        snapshot_id: snapshotId,
                        window_index: windowIndex,
                        tab_index: tabIndex,
                    }
                });
            });

            if (tab.collapsed) {
                collapseButton.classList.add('collapsed');
                const queue = [...children];
                let descendantCount = 0;
                while (queue.length > 0) {
                    const childIndex = queue.shift()!;
                    descendantCount++;
                    const grandChildren = childrenMap.get(childIndex);
                    if (grandChildren) {
                        queue.push(...grandChildren);
                    }
                }

                if (descendantCount > 0) {
                    const countSpan = document.createElement('span');
                    countSpan.className = 'collapsed-count';
                    countSpan.textContent = String(descendantCount);
                    collapseButton.appendChild(countSpan);
                }
            }
            collapseContainer.appendChild(collapseButton);
        }

        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'tree-node-content';
        const icon = document.createElement('img');
        if (isGroup) {
            icon.src = `data:image/svg+xml;base64,${btoa(svg.icon_group)}`;
        } else {
            icon.src = DEFAULT_FAVICON_URL; // Snapshots don't store favicons
        }
        icon.className = 'tree-node-icon';

        const title = document.createElement('span');
        title.className = 'tree-node-title';
        title.textContent = tab.title;
        contentWrapper.append(icon, title);

        const menuButton = document.createElement('button');
        menuButton.className = 'close-tab-button';
        menuButton.innerHTML = '&#x22EE;';
        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showContextMenu(e.clientX, e.clientY, tabIndex as any);
        });
        nodeElement.append(collapseContainer, contentWrapper, menuButton);

        nodeWrapper.appendChild(nodeElement);

        if (children.length > 0 && !tab.collapsed) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'children-container';
            for (const childIndex of children) {
                childrenContainer.appendChild(this.renderSnapshotNode(childIndex, snapshotWindow, snapshotId, windowIndex, childrenMap));
            }
            nodeWrapper.appendChild(childrenContainer);
        }

        return nodeWrapper;
    }

    private renderAddButton(state: State, rootId: BruhId): HTMLDivElement {
        const button = document.createElement('div');
        button.className = 'add-tab-button';
        button.textContent = '+';
        button.addEventListener('click', () => {
            this.sendAction({
                type: 'create_tab',
                payload: { parent_bid: rootId, action: "inside" }
            });
        });

        button.addEventListener('dragover', (event) => {
            event.preventDefault();
            const types = event.dataTransfer?.types;
            if (types && (types.includes('application/json') || types.includes('text/uri-list') || types.includes('text/plain'))) {
                event.dataTransfer!.dropEffect = 'move';
                button.classList.add('drag-over-target');
            }
        });
        button.addEventListener('dragleave', () => button.classList.remove('drag-over-target'));
        button.addEventListener('drop', async (event) => {
            event.preventDefault();
            button.classList.remove('drag-over-target');
            const dataTransfer = event.dataTransfer;
            if (!dataTransfer || !this.currentLiveData) return;

            const types = dataTransfer.types;
            if (types.includes('application/json')) {
                const dragDataStr = dataTransfer.getData('application/json');
                if (!dragDataStr) return;
                const dragData: DragData = JSON.parse(dragDataStr);
                this.currentDragData = null;

                if (dragData.type == "snapshot_item") {
                    this.sendAction({
                        type: 'handle_snapshot_drop',
                        payload: {
                            drag_data: dragData,
                            target_bid: rootId,
                            action: 'inside',
                        },
                    });
                } else {
                    this.sendAction({
                        type: 'handle_drop',
                        payload: {
                            drag_data: dragData,
                            target_bid: rootId,
                            action: `inside`,
                        }
                    });
                }
            } else if (types.includes('text/uri-list') || types.includes('text/plain')) {
                const url = this.getUrlFromDataTransfer(dataTransfer);
                if (!url) return;

                this.sendAction({ type: 'create_tab', payload: { url, parent_bid: rootId, action: "inside" } });
            }
        });
        return button;
    }

    private removeContextMenu = () => {
        document.getElementById('tab-context-menu')?.remove();
        document.removeEventListener('click', this.removeContextMenu);
        document.removeEventListener('contextmenu', this.removeContextMenu);
        window.removeEventListener('blur', this.removeContextMenu);
    }

    private async copyUrl(nodeIdentifier: BruhId | number) {
        let url: string | undefined;
        if (this.currentSnapshotData) {
            const tab = this.currentSnapshotData.window.tabs[nodeIdentifier as number];
            url = tab?.url;
        } else if (this.currentLiveData) {
            url = this.currentLiveData.state.get_node_url(nodeIdentifier as BruhId);
        }

        try {
            if (url) {
                await navigator.clipboard.writeText(url);
            }
        } catch (e) {
            console.error('Failed to copy URL:', e);
        }
    }

    private createContextMenu(x: number, y: number): HTMLDivElement {
        this.removeContextMenu();
        const menu = document.createElement('div');
        menu.id = 'tab-context-menu';
        menu.className = 'context-menu';
        menu.style.visibility = 'hidden';
        menu.addEventListener('click', (e) => e.stopPropagation());

        document.body.appendChild(menu);

        setTimeout(() => {
            const menuWidth = menu.offsetWidth;
            const menuHeight = menu.offsetHeight;
            const viewWidth = document.documentElement.clientWidth;
            const viewHeight = document.documentElement.clientHeight;

            let finalX = x;
            let finalY = y;
            if (x + menuWidth > viewWidth) finalX = viewWidth - menuWidth - 5;
            if (y + menuHeight > viewHeight) finalY = viewHeight - menuHeight - 5;
            finalX = Math.max(5, finalX);
            finalY = Math.max(5, finalY);

            menu.style.left = `${finalX}px`;
            menu.style.top = `${finalY}px`;
            menu.style.visibility = 'visible';

            document.addEventListener('click', this.removeContextMenu, { once: true });
            document.addEventListener('contextmenu', this.removeContextMenu, { once: true });
            window.addEventListener('blur', this.removeContextMenu, { once: true });
        }, 0);

        return menu;
    }

    private showGroupContextMenu(x: number, y: number, identifier: BruhId | number, is_closed: boolean) {
        const menu = this.createContextMenu(x, y);

        const createItem = (label: string, icon: string, action: () => void, disabled: boolean = false) => {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            if (disabled) item.classList.add('disabled');
            const iconSpan = document.createElement('span');
            iconSpan.className = 'context-menu-icon';
            iconSpan.innerHTML = icon;
            const labelSpan = document.createElement('span');
            labelSpan.textContent = label;
            item.append(iconSpan, labelSpan);
            if (!disabled) {
                item.addEventListener('click', () => { action(); this.removeContextMenu(); });
            }
            menu.appendChild(item);
        };

        const createSeparator = () => {
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator';
            menu.appendChild(separator);
        };

        if (this.treeType === "snapshot" && this.currentSnapshotData) {
            const { snapshotId } = this.currentSnapshotData;
            const windowIndex = identifier as number;
            createItem('Restore as New Window', svg.icon_restore, () => {
                this.sendAction({ type: 'restore_snapshot_window', payload: { id: snapshotId, window_index: windowIndex } });
            });
            createItem('Restore to Current Window', svg.icon_restore, () => {
                if (this.currentWindowId) {
                    const dragData: SnapshotDragData = { type: 'snapshot_item', snapshotId: snapshotId, windowIndex: windowIndex };
                    this.sendAction({
                        type: 'handle_snapshot_drop',
                        payload: {
                            drag_data: dragData,
                            target_bid: 0 as BruhId,
                            action: 'inside',
                            target_wid: this.currentWindowId,
                        }
                    });
                }
            }, !this.currentWindowId);
        } else if (is_closed) {
            const wbid = identifier as BruhId;
            createItem('Restore Window', svg.icon_restore, () => this.sendAction({ type: 'restore_window', payload: { wbid } }));
            createSeparator();
            createItem('Delete State', svg.icon_trash, () => this.sendAction({ type: 'delete_window_state', payload: { wbid } }));
        } else {
            const bid = identifier as BruhId;
            createItem('New Group', svg.icon_group, () => this.sendAction({ type: 'create_group', payload: { parent_bid: bid } }));
            createSeparator();
            createItem('Close Window', svg.icon_close, () => this.sendAction({ type: 'close_window', payload: { wbid: bid } }));
        }
    }

    private startNodeRename(nodeId: BruhId) {
        if (!this.currentLiveData) return;
        const nodeElementWrapper = this.container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
        if (!nodeElementWrapper) return;
        const nodeElement = nodeElementWrapper.querySelector<HTMLElement>('.tree-node-content');
        const titleElement = nodeElement?.querySelector<HTMLElement>('.tree-node-title');
        const node = this.currentLiveData.state.get_node(nodeId);

        if (!nodeElement || !titleElement || !node) return;
        const nodeTitle = this.currentLiveData.state.get_node_name(nodeId);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'node-rename-input';
        input.value = nodeTitle;

        const save = () => {
            const newName = input.value.trim();
            titleElement.textContent = newName;
            if (nodeElement.contains(input)) {
                nodeElement.replaceChild(titleElement, input);
            }
            if (newName !== nodeTitle) {
                this.sendAction({ type: 'rename_node', payload: { bid: nodeId, new_name: newName } });
            }
        };

        input.addEventListener('blur', save, { once: true });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            } else if (e.key === 'Escape') {
                nodeElement.replaceChild(titleElement, input);
            }
        });

        nodeElement.replaceChild(input, titleElement);
        input.focus();
        input.select();
    }

    private showContextMenu(x: number, y: number, nodeIdentifier: BruhId | number) {
        const menu = this.createContextMenu(x, y);

        const createItem = (label: string, icon: string, action: () => void, disabled: boolean = false) => {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            if (disabled) item.classList.add('disabled');
            const iconSpan = document.createElement('span');
            iconSpan.className = 'context-menu-icon';
            iconSpan.innerHTML = icon;
            const labelSpan = document.createElement('span');
            labelSpan.textContent = label;
            item.append(iconSpan, labelSpan);
            if (!disabled) {
                item.addEventListener('click', () => { action(); this.removeContextMenu(); });
            }
            menu.appendChild(item);
        };

        const createSeparator = () => {
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator';
            menu.appendChild(separator);
        };

        if (this.treeType === "snapshot" && this.currentSnapshotData) {
            const { snapshotId, windowIndex } = this.currentSnapshotData;
            const tabIndex = nodeIdentifier as number;
            createItem('Restore as New Window', svg.icon_restore, () => {
                this.sendAction({ type: 'restore_snapshot_subtree', payload: { id: snapshotId, window_index: windowIndex, tab_index: tabIndex } });
            });
            createItem('Restore to Current Window', svg.icon_restore, () => {
                if (this.currentWindowId) {
                    const dragData: SnapshotDragData = {
                        type: 'snapshot_item',
                        snapshotId: snapshotId,
                        windowIndex: windowIndex,
                        tabIndex: tabIndex,
                    };
                    this.sendAction({
                        type: 'handle_snapshot_drop',
                        payload: {
                            drag_data: dragData,
                            target_bid: 0 as BruhId,
                            action: 'inside',
                            target_wid: this.currentWindowId,
                        }
                    });
                }
            }, !this.currentWindowId);
            createSeparator();
            createItem('Copy URL', svg.icon_copy, () => this.copyUrl(nodeIdentifier));
            return;
        }

        if (!this.currentLiveData) return;
        const state = this.currentLiveData.state;
        const nodeId = nodeIdentifier as BruhId;
        const node = state.get_node(nodeId);
        if (!node) return;

        const isNodeClosed = state.is_node_closed(nodeId);

        if (node.type === 'group') {
            createItem('Rename Group', svg.icon_edit, () => this.startNodeRename(nodeId));
            createSeparator();
        }

        createItem('New Group Here', svg.icon_group, () => {
            this.sendAction({ type: 'create_group', payload: { parent_bid: nodeId } })
        });
        createItem('Duplicate Tab', svg.icon_duplicate, () => this.sendAction({ type: 'duplicate_tab', payload: { bid: nodeId } }));
        createSeparator();

        if (!isNodeClosed) {
            createItem('Load Tree', svg.icon_load, () => this.sendAction({ type: 'reload_tree', payload: { bid: nodeId } }));
            createItem('Unload Tab', svg.icon_unload, () => this.sendAction({ type: 'unload_tabs', payload: { bid: nodeId, recursive: false } }));

            if (state.get_immediate_children(nodeId).length > 0) {
                createItem('Unload Tree', svg.icon_unload, () => this.sendAction({ type: 'unload_tabs', payload: { bid: nodeId, recursive: true } }));
            }
            createSeparator();
        }

        createItem('Close Tab Only', svg.icon_close, () => this.sendAction({ type: 'close_tabs', payload: { bid: nodeId, recursive: false } }));
        if (state.get_immediate_children(nodeId).length > 0) {
            createItem('Close Tree', svg.icon_tree, () => this.sendAction({ type: 'close_tabs', payload: { bid: nodeId, recursive: true } }));
        }
        createItem('Move to New Window', svg.icon_window, () => this.sendAction({ type: 'move_subtree_to_new_window', payload: { bid: nodeId } }));
        createSeparator();

        if (state.get_immediate_children(nodeId).length > 0) {
            createItem('Flatten Immediate Children', svg.icon_flatten_immediate, () => this.sendAction({ type: 'flatten_tree', payload: { bid: nodeId, recursive: false } }));
            createItem('Flatten Tree', svg.icon_flatten_tree, () => this.sendAction({ type: 'flatten_tree', payload: { bid: nodeId, recursive: true } }));
            createSeparator();
        }

        createItem('Copy URL', svg.icon_copy, () => this.copyUrl(nodeIdentifier));
    }
}
