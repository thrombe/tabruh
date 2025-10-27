import './tab_tree_view.css';
import browser from 'webextension-polyfill';
import type { DragData, AppRequest, UiStateForRender, DropAction, BruhId, UiNode, WindowId, SnapshotDragData, ExtensionAction, StateAction } from './types';

const DEFAULT_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
const DEFAULT_FAVICON_URL = `data:image/svg+xml;base64,${btoa(DEFAULT_FAVICON)}`;

const ICON_DUPLICATE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const ICON_LOAD = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
const ICON_UNLOAD = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>`;
const ICON_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const ICON_COPY = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72"></path></svg>`;
const ICON_WINDOW = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
const ICON_TREE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 18h4"/><path d="M12 10v8"/><path d="M12 3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M5 3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M19 3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M5 10v3a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2v-3"/><path d="M19 10v3a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2v-3"/></svg>`;
const ICON_RESTORE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/></svg>`;
const ICON_TRASH = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
const ICON_FLATTEN_IMMEDIATE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="14 9 9 4 4 9"/><path d="M20 20h-7a4 4 0 0 1-4-4V4"/></svg>`;
const ICON_FLATTEN_TREE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 1 9 9"/></svg>`;
const ICON_GROUP = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
const ICON_EDIT = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`;


export class TabTreeView {
    private container: HTMLElement;
    private port: browser.Runtime.Port;
    private currentRenderState: UiStateForRender | null = null;
    private currentDragData: DragData | null = null;
    private treeType: "sidebar" | "overview" | "snapshot";
    private viewType: 'window' | 'group';
    private currentWindowId?: WindowId;

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

    public render(state: UiStateForRender) {
        this.currentRenderState = state;
        this.container.innerHTML = '';
        if (state.is_closed && this.treeType !== "snapshot") {
            this.container.classList.add('closed-group');
        } else {
            this.container.classList.remove('closed-group');
        }

        this.container.appendChild(this.renderHeader(state));

        if (state.collapsed) return;

        const treeContainer = document.createElement('div');
        treeContainer.className = 'tab-tree-scroll-container';

        const rootContainer = document.createElement('div');
        rootContainer.className = 'flex flex-col';

        for (const rootId of state.root_bids) {
            const nodeElement = this.renderNode(rootId, state);
            rootContainer.appendChild(nodeElement);
        }
        treeContainer.appendChild(rootContainer);

        treeContainer.appendChild(this.renderAddButton(state));

        this.container.appendChild(treeContainer);
    }

    private getNodeSubtreeIds(rootId: BruhId, tree: Map<BruhId, UiNode>): BruhId[] {
        const subtreeIds: BruhId[] = [];
        const queue: BruhId[] = [rootId];
        const visited = new Set<BruhId>();
        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) continue;
            visited.add(currentId);
            subtreeIds.push(currentId);
            const node = tree.get(currentId);
            if (node) {
                queue.push(...node.children);
            }
        }
        return subtreeIds;
    }

    private countAllDescendants(nodeId: BruhId, tree: Map<BruhId, UiNode>): number {
        const node = tree.get(nodeId);
        if (!node) return 0;
        let count = 0;
        const queue = [...node.children];
        while (queue.length > 0) {
            const currentId = queue.shift()!;
            count++;
            const currentNode = tree.get(currentId);
            if (currentNode && currentNode.children.length > 0) {
                queue.push(...currentNode.children);
            }
        }
        return count;
    }

    private getUrlFromDataTransfer(dataTransfer: DataTransfer): string | null {
        const url = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain');
        return url ? url.trim() : null;
    }

    private renderNode(nodeId: BruhId, state: UiStateForRender): HTMLDivElement {
        const { tree, is_closed } = state;
        const node = tree.get(nodeId)!;
        const nodeWrapper = document.createElement('div');
        nodeWrapper.dataset.nodeId = String(node.id);

        const nodeElement = document.createElement('div');
        nodeElement.className = 'tree-node';
        if (node.isGroup) {
            nodeElement.classList.add('group-node');
        }
        nodeElement.draggable = true;

        if ((node.isDiscarded || is_closed) && this.treeType !== "snapshot") nodeElement.classList.add('discarded-tab');
        if (node.isActive && this.treeType !== "snapshot") nodeElement.classList.add('focused-tab');

        if (this.treeType !== "snapshot") {
            if (!is_closed) {
                nodeElement.addEventListener('click', () => this.sendAction({ type: 'focus_tab', payload: { bid: node.id } }));
            }
            nodeElement.addEventListener('mousedown', (event) => {
                if (event.button === 1) {
                    event.preventDefault();
                    this.sendAction({ type: 'close_tabs', payload: { bid: node.id, recursive: false } });
                }
            });
        }
        nodeElement.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showContextMenu(e.clientX, e.clientY, node.id); });

        nodeElement.addEventListener('dragstart', (event) => {
            event.stopPropagation();
            let dragData: DragData;
            if (state.is_read_only) {
                dragData = {
                    type: 'snapshot_item',
                    snapshotId: state.snapshot_id!,
                    windowIndex: state.window_index!,
                    tabIndex: node.tab_index,
                };
            } else {
                const movedNodeIds = this.getNodeSubtreeIds(node.id, tree);
                dragData = {
                    type: 'tabs',
                    draggedNodeId: node.id,
                    sourceWindowId: state.wbid,
                    movedNodeIds,
                };
            }
            this.currentDragData = dragData;
            event.dataTransfer!.setData('application/json', JSON.stringify(dragData));
            event.dataTransfer!.effectAllowed = 'move';
            setTimeout(() => nodeElement.classList.add('dragging'), 0);
        });

        if (this.treeType !== "snapshot") {
            nodeElement.addEventListener('dragend', (event) => {
                nodeElement.classList.remove('dragging');
                const dragData = this.currentDragData;
                // Type guard to ensure we are dealing with a live drag
                if (event.dataTransfer?.dropEffect === 'none' && dragData && dragData.type !== 'snapshot_item') {
                    this.sendAction({ type: 'move_subtree_to_new_window', payload: { bid: dragData.draggedNodeId } });
                }
                this.currentDragData = null;
            });
        } else {
            nodeElement.addEventListener('dragend', () => {
                nodeElement.classList.remove('dragging');
                this.currentDragData = null;
            });
        }

        nodeElement.addEventListener('dragover', (event) => {
            event.preventDefault();
            const types = event.dataTransfer?.types;
            if (!types || !(types.includes('application/json') || types.includes('text/uri-list') || types.includes('text/plain'))) {
                return;
            }
            if (this.treeType === "snapshot") return; // Don't allow dropping onto snapshot views

            if (types.includes('application/json')) {
                const dragDataStr = event.dataTransfer?.getData('application/json');
                if (dragDataStr) {
                    const dragData: DragData = JSON.parse(dragDataStr);
                    if (dragData.type === 'tabs' && dragData.movedNodeIds.includes(node.id)) {
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
            if (this.treeType === "snapshot") return; // Safety check
            nodeElement.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
            const action = nodeElement.dataset.dropAction as DropAction;
            delete nodeElement.dataset.dropAction;

            const dataTransfer = event.dataTransfer;
            if (!dataTransfer || !state.wbid) return;

            const types = dataTransfer.types;
            if (types.includes('application/json')) {
                const dragDataStr = dataTransfer.getData('application/json');
                if (!dragDataStr) return;
                const dragData: DragData = JSON.parse(dragDataStr);
                this.currentDragData = null;

                if (dragData.type === 'snapshot_item') {
                    this.sendAction({ type: 'handle_snapshot_drop', payload: { drag_data: dragData, target_bid: node.id, action } });
                } else if ((dragData.type === 'tabs' || dragData.type === 'window') && !dragData.movedNodeIds.includes(node.id)) {
                    this.sendAction({ type: 'handle_drop', payload: { drag_data: dragData, target_bid: node.id, action } });
                }
            } else if (types.includes('text/uri-list') || types.includes('text/plain')) {
                const url = this.getUrlFromDataTransfer(dataTransfer);
                if (!url) return;
                this.sendAction({ type: 'create_tab', payload: { url, parent_bid: node.id, action } });
            }
        });

        const collapseContainer = document.createElement('div');
        collapseContainer.className = 'collapse-container';

        if (node.children.length > 0) {
            const collapseButton = document.createElement('button');
            collapseButton.className = 'collapse-button';
            collapseButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="arrow-svg"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            collapseButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.treeType !== "snapshot") {
                    this.sendAction({ type: 'toggle_collapse', payload: { bid: node.id } });
                } else {
                    if (this.currentRenderState?.snapshot_id !== undefined && this.currentRenderState?.window_index !== undefined) {
                        this.sendAction({
                            type: 'toggle_snapshot_collapse',
                            payload: {
                                snapshot_id: this.currentRenderState.snapshot_id,
                                window_index: this.currentRenderState.window_index,
                                tab_index: node.tab_index,
                            }
                        });
                    }
                }
            });

            if (node.isCollapsed) {
                collapseButton.classList.add('collapsed');
                const descendantCount = this.countAllDescendants(nodeId, tree);
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
        if (node.isGroup) {
            icon.src = `data:image/svg+xml;base64,${btoa(ICON_GROUP)}`;
        } else {
            icon.src = node.favIconUrl || DEFAULT_FAVICON_URL;
            icon.onerror = () => { if (icon.src !== DEFAULT_FAVICON_URL) icon.src = DEFAULT_FAVICON_URL; };
        }
        icon.className = 'tree-node-icon';

        const title = document.createElement('span');
        title.className = 'tree-node-title';
        title.textContent = node.title;
        contentWrapper.append(icon, title);

        if (this.treeType === "snapshot") {
            const menuButton = document.createElement('button');
            menuButton.className = 'close-tab-button'; // Re-use style for positioning
            menuButton.innerHTML = '&#x22EE;';
            menuButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showContextMenu(e.clientX, e.clientY, node.id);
            });
            nodeElement.append(collapseContainer, contentWrapper, menuButton);
        } else {
            const closeButton = document.createElement('button');
            closeButton.className = 'close-tab-button';
            closeButton.innerHTML = ICON_CLOSE;
            closeButton.addEventListener('click', (e) => { e.stopPropagation(); this.sendAction({ type: 'close_tabs', payload: { bid: node.id, recursive: false } }); });
            nodeElement.append(collapseContainer, contentWrapper, closeButton);
        }

        nodeWrapper.appendChild(nodeElement);

        if (node.children.length > 0 && !node.isCollapsed) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'children-container';
            for (const childId of node.children) {
                childrenContainer.appendChild(this.renderNode(childId, state));
            }
            nodeWrapper.appendChild(childrenContainer);
        }

        return nodeWrapper;
    }

    private renderHeader(state: UiStateForRender): HTMLDivElement {
        const header = document.createElement('div');
        header.className = 'tab-tree-header';
        header.draggable = true;

        const collapseButton = document.createElement('button');
        if (state.is_read_only) {
            collapseButton.className = 'group-menu-button header-collapse-button'; // Use similar style
            collapseButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="arrow-svg"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            if (state.collapsed) {
                collapseButton.classList.add('collapsed');
            }
            collapseButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.sendAction({ type: 'toggle_snapshot_window_collapse', payload: { snapshot_id: state.snapshot_id!, window_index: state.window_index! } });
            });
        }

        header.addEventListener('dragstart', (event) => {
            event.stopPropagation();
            let dragData: DragData;
            if (state.is_read_only) {
                dragData = {
                    type: 'snapshot_item',
                    snapshotId: state.snapshot_id!,
                    windowIndex: state.window_index!,
                    tabIndex: undefined, // undefined means whole window
                };
            } else {
                const movedNodeIds = Array.from(state.tree.keys());
                dragData = {
                    type: 'window',
                    draggedNodeId: state.id,
                    sourceWindowId: state.wbid,
                    movedNodeIds,
                };
            }
            this.currentDragData = dragData;
            event.dataTransfer!.setData('application/json', JSON.stringify(dragData));
            event.dataTransfer!.effectAllowed = 'move';
            setTimeout(() => this.container.classList.add('dragging'), 0);
        });

        if (this.treeType !== "snapshot") {
            header.addEventListener('dragend', () => {
                this.container.classList.remove('dragging');
                this.currentDragData = null;
            });
        } else {
            header.addEventListener('dragend', () => {
                this.container.classList.remove('dragging');
                this.currentDragData = null;
            });
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'group-name';
        if (state.is_closed && this.treeType !== "snapshot") {
            nameSpan.textContent = `[Closed] ${state.name}`;
        } else {
            nameSpan.textContent = state.name;
        }

        if (this.treeType !== "snapshot") {
            nameSpan.addEventListener('click', () => {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'group-name-input';
                input.value = state.name;
                header.replaceChild(input, nameSpan);
                input.focus();
                input.select();
                const save = () => {
                    if (input.value.trim()) {
                        this.sendAction({ type: 'rename_node', payload: { bid: state.id, new_name: input.value.trim() } });
                    }
                    header.replaceChild(nameSpan, input);
                };
                input.addEventListener('blur', save);
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') save();
                    if (e.key === 'Escape') header.replaceChild(nameSpan, input);
                });
            });
        } else {
            nameSpan.classList.remove('cursor-pointer');
        }

        const menuButton = document.createElement('button');
        menuButton.className = 'group-menu-button';
        menuButton.innerHTML = '&#x22EE;';
        menuButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showGroupContextMenu(e.clientX, e.clientY, state);
        });

        header.append(collapseButton, nameSpan, menuButton);
        return header;
    }

    private renderAddButton(state: UiStateForRender): HTMLDivElement {
        if (this.treeType === "snapshot") {
            return document.createElement('div');
        }
        const button = document.createElement('div');
        button.className = 'add-tab-button';
        button.textContent = '+';
        button.addEventListener('click', () => {
            this.sendAction({
                type: 'create_tab',
                payload: { parent_bid: state.id, action: "inside" }
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
            if (!dataTransfer || !this.currentRenderState) return;

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
                            target_bid: state.id,
                            action: 'inside',
                        },
                    });
                } else {
                    this.sendAction({
                        type: 'handle_drop',
                        payload: {
                            drag_data: dragData,
                            target_bid: state.id,
                            action: `inside`,
                        }
                    });
                }
            } else if (types.includes('text/uri-list') || types.includes('text/plain')) {
                const url = this.getUrlFromDataTransfer(dataTransfer);
                if (!url) return;

                this.sendAction({ type: 'create_tab', payload: { url, parent_bid: state.id, action: "inside" } });
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

    private async copyUrl(nodeId: BruhId) {
        try {
            const node = this.currentRenderState?.tree.get(nodeId);
            if (node?.url) {
                await navigator.clipboard.writeText(node.url);
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

    private showGroupContextMenu(x: number, y: number, state: UiStateForRender) {
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

        if (this.treeType === "snapshot") {
            createItem('Restore as New Window', ICON_RESTORE, () => {
                if (state.snapshot_id !== undefined && state.window_index !== undefined) {
                    this.sendAction({ type: 'restore_snapshot_window', payload: { id: state.snapshot_id, window_index: state.window_index } });
                }
            });
            createItem('Restore to Current Window', ICON_RESTORE, () => {
                if (state.snapshot_id !== undefined && state.window_index !== undefined && this.currentWindowId) {
                    const dragData: SnapshotDragData = { type: 'snapshot_item', snapshotId: state.snapshot_id, windowIndex: state.window_index };
                    // We send a dummy target_bid and action because target_wid takes precedence in the background script.
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
        } else if (state.is_closed) {
            createItem('Restore Window', ICON_RESTORE, () => this.sendAction({ type: 'restore_window', payload: { wbid: state.wbid } }));
            createSeparator();
            createItem('Delete State', ICON_TRASH, () => this.sendAction({ type: 'delete_window_state', payload: { wbid: state.wbid } }));
        } else {
            createItem('New Group', ICON_GROUP, () => this.sendAction({ type: 'create_group', payload: { parent_bid: state.id } }));
            createSeparator();
            createItem('Close Window', ICON_CLOSE, () => this.sendAction({ type: 'close_window', payload: { wbid: state.wbid } }));
        }
    }

    private startNodeRename(nodeId: BruhId) {
        const nodeElementWrapper = this.container.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
        if (!nodeElementWrapper) return;
        const nodeElement = nodeElementWrapper.querySelector<HTMLElement>('.tree-node-content');
        const titleElement = nodeElement?.querySelector<HTMLElement>('.tree-node-title');
        const node = this.currentRenderState?.tree.get(nodeId);

        if (!nodeElement || !titleElement || !node) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'node-rename-input';
        input.value = node.title;

        const save = () => {
            const newName = input.value.trim();
            titleElement.textContent = newName;
            if (nodeElement.contains(input)) {
                nodeElement.replaceChild(titleElement, input);
            }
            if (newName !== node.title) {
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

    private showContextMenu(x: number, y: number, nodeId: BruhId) {
        if (!this.currentRenderState) return;
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

        const node = this.currentRenderState.tree.get(nodeId);
        if (!node) return;

        if (this.treeType === "snapshot") {
            createItem('Restore as New Window', ICON_RESTORE, () => {
                const { snapshot_id, window_index } = this.currentRenderState!;
                if (snapshot_id !== undefined && window_index !== undefined) {
                    this.sendAction({ type: 'restore_snapshot_subtree', payload: { id: snapshot_id, window_index, tab_index: node.tab_index } });
                }
            });
            createItem('Restore to Current Window', ICON_RESTORE, () => {
                const { snapshot_id, window_index } = this.currentRenderState!;
                if (snapshot_id !== undefined && window_index !== undefined && this.currentWindowId) {
                    const dragData: SnapshotDragData = {
                        type: 'snapshot_item',
                        snapshotId: snapshot_id,
                        windowIndex: window_index,
                        tabIndex: node.tab_index,
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
            createItem('Copy URL', ICON_COPY, () => this.copyUrl(nodeId));
            return;
        }

        const isNodeClosed = node.isDiscarded || this.currentRenderState.is_closed;

        if (node.isGroup) {
            createItem('Rename Group', ICON_EDIT, () => this.startNodeRename(nodeId));
            createSeparator();
        }

        createItem('New Group Here', ICON_GROUP, () => {
            if (this.currentRenderState?.wbid) {
                this.sendAction({ type: 'create_group', payload: { parent_bid: nodeId } })
            }
        });
        createItem('Duplicate Tab', ICON_DUPLICATE, () => this.sendAction({ type: 'duplicate_tab', payload: { bid: nodeId } }));
        createSeparator();

        if (!isNodeClosed) {
            createItem('Load Tree', ICON_LOAD, () => this.sendAction({ type: 'reload_tree', payload: { bid: nodeId } }));
            createItem('Unload Tab', ICON_UNLOAD, () => this.sendAction({ type: 'unload_tabs', payload: { bid: nodeId, recursive: false } }));

            if (node.children.length > 0) {
                createItem('Unload Tree', ICON_UNLOAD, () => this.sendAction({ type: 'unload_tabs', payload: { bid: nodeId, recursive: true } }));
            }
            createSeparator();
        }

        createItem('Close Tab Only', ICON_CLOSE, () => this.sendAction({ type: 'close_tabs', payload: { bid: nodeId, recursive: false } }));
        if (node.children.length > 0) {
            createItem('Close Tree', ICON_TREE, () => this.sendAction({ type: 'close_tabs', payload: { bid: nodeId, recursive: true } }));
        }
        createItem('Move to New Window', ICON_WINDOW, () => this.sendAction({ type: 'move_subtree_to_new_window', payload: { bid: nodeId } }));
        createSeparator();

        if (node.children.length > 0) {
            createItem('Flatten Immediate Children', ICON_FLATTEN_IMMEDIATE, () => this.sendAction({ type: 'flatten_tree', payload: { bid: nodeId, recursive: false } }));
            createItem('Flatten Tree', ICON_FLATTEN_TREE, () => this.sendAction({ type: 'flatten_tree', payload: { bid: nodeId, recursive: true } }));
            createSeparator();
        }

        createItem('Copy URL', ICON_COPY, () => this.copyUrl(nodeId));
    }
}
