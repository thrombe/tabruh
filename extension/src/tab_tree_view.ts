import './tab_tree_view.css';
import browser from 'webextension-polyfill';
import type { DragData, TabTree, BackgroundRequest, UiStateForRender, DropAction } from './types';

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
    private isSidebar: boolean;

    constructor(container: HTMLElement, port: browser.Runtime.Port, isSidebar: boolean = false) {
        this.container = container;
        this.port = port;
        this.isSidebar = isSidebar;
        this.container.classList.add('tab-tree-view-container');
    }

    private sendMessage(message: BackgroundRequest) {
        try {
            this.port.postMessage(message);
        } catch (e) {
            console.error("Could not send message to background script.", e);
        }
    }

    public render(state: UiStateForRender) {
        this.currentRenderState = state;
        this.container.innerHTML = '';
        if (state.isClosed) {
            this.container.classList.add('closed-group');
        } else {
            this.container.classList.remove('closed-group');
        }

        this.container.appendChild(this.renderHeader(state));

        const treeContainer = document.createElement('div');
        treeContainer.className = 'tab-tree-scroll-container';

        const rootContainer = document.createElement('div');
        rootContainer.className = 'flex flex-col';

        for (const rootId of state.rootIds) {
            const nodeElement = this.renderNode(rootId, state);
            rootContainer.appendChild(nodeElement);
        }
        treeContainer.appendChild(rootContainer);

        if (!state.isClosed) {
            treeContainer.appendChild(this.renderAddButton(state));
        }

        this.container.appendChild(treeContainer);
    }

    private getTabSubtreeIds(rootId: number, tree: TabTree): number[] {
        const subtreeIds: number[] = [];
        const queue = [rootId];
        const visited = new Set<number>();
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

    private countAllDescendants(nodeId: number, tree: TabTree): number {
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

    private findLastDescendantIndex(startNodeId: number, tree: TabTree, tabsById: Map<number, browser.Tabs.Tab>): number {
        const startTab = tabsById.get(startNodeId);
        if (!startTab) return -1;

        let maxIndex = startTab.index;
        const subtreeIds = this.getTabSubtreeIds(startNodeId, tree);
        for (const id of subtreeIds) {
            const tab = tabsById.get(id);
            if (tab && tab.index > maxIndex) {
                maxIndex = tab.index;
            }
        }
        return maxIndex;
    }

    private getUrlFromDataTransfer(dataTransfer: DataTransfer): string | null {
        const url = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain');
        return url ? url.trim() : null;
    }

    private renderNode(nodeId: number, state: UiStateForRender): HTMLDivElement {
        const { tree, tabsById, collapsedNodes, id: stateId, isClosed } = state;
        const node = tree.get(nodeId)!;
        const nodeWrapper = document.createElement('div');
        nodeWrapper.dataset.tabId = String(node.id);

        const nodeElement = document.createElement('div');
        nodeElement.className = 'tree-node';
        if (node.isGroup) {
            nodeElement.classList.add('group-node');
        }
        nodeElement.draggable = !isClosed;

        const tab = tabsById.get(node.id);
        if (tab?.discarded || isClosed) nodeElement.classList.add('discarded-tab');
        if (tab?.active) nodeElement.classList.add('focused-tab');

        if (!isClosed) {
            nodeElement.addEventListener('click', () => this.sendMessage({ type: 'FOCUS_TAB', payload: { tabId: node.id } }));
            nodeElement.addEventListener('mousedown', (event) => {
                if (event.button === 1) {
                    event.preventDefault();
                    this.sendMessage({ type: 'CLOSE_SINGLE_TAB', payload: { tabId: node.id } });
                }
            });
            nodeElement.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showContextMenu(e.clientX, e.clientY, node.id); });
        }


        nodeElement.addEventListener('dragstart', (event) => {
            const movedTabIds = this.getTabSubtreeIds(node.id, tree);
            const parentMapSnapshot: Record<number, number | undefined> = {};
            for (const id of movedTabIds) {
                const n = tree.get(id);
                if (n) parentMapSnapshot[id] = n.parentId;
            }
            const collapsedInSubtree = movedTabIds.filter(id => collapsedNodes.has(id));

            const dragData: DragData = {
                draggedTabId: node.id,
                sourceStateId: stateId,
                movedTabIds,
                parentMapSnapshot,
                collapsed: collapsedInSubtree
            };
            this.currentDragData = dragData;
            event.dataTransfer!.setData('application/json', JSON.stringify(dragData));
            event.dataTransfer!.effectAllowed = 'move';
            setTimeout(() => nodeElement.classList.add('dragging'), 0);
        });

        nodeElement.addEventListener('dragend', (event) => {
            nodeElement.classList.remove('dragging');
            if (event.dataTransfer?.dropEffect === 'none' && this.currentDragData) {
                this.sendMessage({ type: 'MOVE_SUBTREE_TO_NEW_WINDOW', payload: { rootTabId: this.currentDragData.draggedTabId } });
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
                    if (dragData.movedTabIds.includes(node.id)) return;
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
            if (!dataTransfer) return;
            if (isClosed) return;

            const types = dataTransfer.types;
            if (types.includes('application/json')) {
                const dragDataStr = dataTransfer.getData('application/json');
                if (!dragDataStr) return;
                const dragData: DragData = JSON.parse(dragDataStr);

                this.currentDragData = null;
                if (dragData.movedTabIds.includes(node.id)) return;

                if (dragData.sourceStateId !== stateId) {
                    this.sendMessage({ type: 'APPLY_PENDING_DATA', payload: { dragData, targetStateId: stateId } });
                }
                this.sendMessage({ type: 'HANDLE_DROP', payload: { dragData, targetTabId: node.id, action, targetStateId: stateId } });
            } else if (types.includes('text/uri-list') || types.includes('text/plain')) {
                const url = this.getUrlFromDataTransfer(dataTransfer);
                if (!url || !this.currentRenderState || !state.windowId) return;

                let index: number | undefined;
                let parentId: number | undefined;

                switch (action) {
                    case 'above':
                        index = tabsById.get(nodeId)?.index;
                        parentId = state.tree.get(nodeId)?.parentId;
                        break;
                    case 'below':
                        index = this.findLastDescendantIndex(nodeId, tree, tabsById) + 1;
                        parentId = state.tree.get(nodeId)?.parentId;
                        break;
                    case 'inside':
                    default:
                        index = this.findLastDescendantIndex(nodeId, tree, tabsById) + 1;
                        parentId = nodeId;
                        break;
                }
                this.sendMessage({ type: 'CREATE_TAB_FROM_URL', payload: { url, windowId: state.windowId, index, parentId } });
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
                this.sendMessage({ type: 'TOGGLE_COLLAPSE', payload: { nodeId: node.id, stateId } });
            });

            if (collapsedNodes.has(nodeId)) {
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
        title.textContent = node.customTitle || node.title;
        contentWrapper.append(icon, title);

        if (!isClosed) {
            const closeButton = document.createElement('button');
            closeButton.className = 'close-tab-button';
            closeButton.textContent = '⨯';
            closeButton.addEventListener('click', (e) => { e.stopPropagation(); this.sendMessage({ type: 'CLOSE_SINGLE_TAB', payload: { tabId: node.id } }); });
            nodeElement.append(collapseContainer, contentWrapper, closeButton);
        } else {
            nodeElement.append(collapseContainer, contentWrapper);
        }

        nodeWrapper.appendChild(nodeElement);

        if (node.children.length > 0) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'children-container';
            if (collapsedNodes.has(nodeId)) {
                childrenContainer.classList.add('hidden');
            }
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

        const nameSpan = document.createElement('span');
        nameSpan.className = 'group-name';
        nameSpan.textContent = state.name;
        if (state.isClosed) {
            nameSpan.textContent = `[Closed] ${state.name}`;
        }
        nameSpan.addEventListener('click', () => {
            if (state.isClosed) return;
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'group-name-input';
            input.value = state.name;
            header.replaceChild(input, nameSpan);
            input.focus();
            input.select();
            const save = () => {
                if (input.value.trim()) {
                    this.sendMessage({ type: 'RENAME_WINDOW', payload: { stateId: state.id, newName: input.value.trim() } });
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
            this.showGroupContextMenu(e.clientX, e.clientY, state);
        });

        header.append(nameSpan, menuButton);
        return header;
    }

    private renderAddButton(state: UiStateForRender): HTMLDivElement {
        const button = document.createElement('div');
        button.className = 'add-tab-button';
        button.textContent = '+';
        button.addEventListener('click', () => {
            if (state.windowId) {
                this.sendMessage({ type: 'CREATE_TAB', payload: { windowId: state.windowId } });
            }
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

            if (!state.windowId) return;

            const types = dataTransfer.types;
            if (types.includes('application/json')) {
                const dragDataStr = dataTransfer.getData('application/json');
                if (!dragDataStr) return;
                const dragData: DragData = JSON.parse(dragDataStr);
                this.currentDragData = null;
                if (dragData.sourceStateId !== this.currentRenderState.id) {
                    this.sendMessage({ type: 'APPLY_PENDING_DATA', payload: { dragData, targetStateId: this.currentRenderState.id } });
                }
                this.sendMessage({ type: 'HANDLE_DROP', payload: { dragData, targetTabId: -1, action: 'root', targetStateId: this.currentRenderState.id } });
            } else if (types.includes('text/uri-list') || types.includes('text/plain')) {
                const url = this.getUrlFromDataTransfer(dataTransfer);
                if (!url) return;
                this.sendMessage({ type: 'CREATE_TAB_FROM_URL', payload: { url, windowId: state.windowId, index: -1 } });
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

    private async copyUrl(tabId: number) {
        try {
            const tab = this.currentRenderState?.tabsById.get(tabId);
            if (tab?.url) {
                await navigator.clipboard.writeText(tab.url);
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

        if (state.isClosed) {
            createItem('Restore Window', ICON_RESTORE, () => this.sendMessage({ type: 'RESTORE_WINDOW', payload: { stateId: state.id } }));
        } else {
            createItem('New Group', ICON_GROUP, () => this.sendMessage({ type: 'CREATE_GROUP', payload: { windowId: state.windowId! } }));
            createSeparator();
            createItem('Close Window', ICON_CLOSE, () => this.sendMessage({ type: 'CLOSE_WINDOW', payload: { stateId: state.id } }));
        }
        createSeparator();
        createItem('Delete State', ICON_TRASH, () => this.sendMessage({ type: 'DELETE_WINDOW_STATE', payload: { stateId: state.id } }));
    }

    private startNodeRename(nodeId: number) {
        const nodeElement = this.container.querySelector<HTMLElement>(`[data-tab-id="${nodeId}"] .tree-node-content`);
        const titleElement = nodeElement?.querySelector<HTMLElement>('.tree-node-title');
        const node = this.currentRenderState?.tree.get(nodeId);

        if (!nodeElement || !titleElement || !node) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'node-rename-input';
        input.value = node.customTitle || node.title;

        nodeElement.replaceChild(input, titleElement);
        input.focus();
        input.select();

        const save = () => {
            if (input.value.trim() !== (node.customTitle || node.title)) {
                this.sendMessage({ type: 'RENAME_NODE', payload: { nodeId, newName: input.value.trim() } });
            }
            nodeElement.replaceChild(titleElement, input);
        };

        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') nodeElement.replaceChild(titleElement, input);
        });
    }

    private showContextMenu(x: number, y: number, tabId: number) {
        if (!this.currentRenderState) return;
        const menu = this.createContextMenu(x, y);

        const createItem = (label: string, icon: string, action: () => void) => {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            const iconSpan = document.createElement('span');
            iconSpan.className = 'context-menu-icon';
            iconSpan.innerHTML = icon;
            const labelSpan = document.createElement('span');
            labelSpan.textContent = label;
            item.append(iconSpan, labelSpan);
            item.addEventListener('click', () => { action(); this.removeContextMenu(); });
            menu.appendChild(item);
        };

        const createSeparator = () => {
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator';
            menu.appendChild(separator);
        };

        const node = this.currentRenderState.tree.get(tabId);
        const tab = this.currentRenderState.tabsById.get(tabId);

        if (node?.isGroup) {
            createItem('Rename Group', ICON_EDIT, () => this.startNodeRename(tabId));
            createItem('Pop out to New Window', ICON_WINDOW, () => this.sendMessage({ type: 'POP_OUT_GROUP', payload: { tabId } }));
            createSeparator();
        }

        createItem('New Group Here', ICON_GROUP, () => {
            if (this.currentRenderState?.windowId && tab) {
                const parentId = node?.parentId;
                const index = this.findLastDescendantIndex(tabId, this.currentRenderState.tree, this.currentRenderState.tabsById) + 1;
                this.sendMessage({ type: 'CREATE_GROUP', payload: { windowId: this.currentRenderState.windowId, parentId, index } })
            }
        });
        createItem('Duplicate Tab', ICON_DUPLICATE, () => this.sendMessage({ type: 'DUPLICATE_TAB_SMART', payload: { tabId } }));
        createSeparator();

        if (tab?.discarded) {
            createItem('Load Tree', ICON_LOAD, () => this.sendMessage({ type: 'LOAD_TREE', payload: { tabId } }));
        } else {
            createItem('Unload Tab', ICON_UNLOAD, () => this.sendMessage({ type: 'UNLOAD_TAB', payload: { tabId } }));
        }

        if (node && node.children.length > 0) {
            if (!tab?.discarded) {
                createItem('Unload Tree', ICON_UNLOAD, () => this.sendMessage({ type: 'UNLOAD_TREE', payload: { tabId } }));
            }
        }
        createSeparator();

        createItem('Close Tab Only', ICON_CLOSE, () => this.sendMessage({ type: 'CLOSE_SINGLE_TAB', payload: { tabId } }));
        if (node && node.children.length > 0) {
            createItem('Close Tree', ICON_TREE, () => this.sendMessage({ type: 'CLOSE_SUBTREE', payload: { tabId } }));
        }
        createItem('Move to New Window', ICON_WINDOW, () => this.sendMessage({ type: 'MOVE_SUBTREE_TO_NEW_WINDOW', payload: { rootTabId: tabId } }));
        createSeparator();

        if (node && node.children.length > 0) {
            createItem('Flatten Immediate Children', ICON_FLATTEN_IMMEDIATE, () => this.sendMessage({ type: 'FLATTEN_IMMEDIATE', payload: { tabId } }));
            createItem('Flatten Tree', ICON_FLATTEN_TREE, () => this.sendMessage({ type: 'FLATTEN_TREE', payload: { tabId } }));
            createSeparator();
        }

        createItem('Copy URL', ICON_COPY, () => this.copyUrl(tabId));
    }
}
