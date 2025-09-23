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

export class TabTreeView {
    private container: HTMLElement;
    private port: browser.Runtime.Port;
    private windowId: number;
    private currentRenderState: UiStateForRender | null = null;
    private currentDragData: DragData | null = null;

    constructor(container: HTMLElement, port: browser.Runtime.Port, windowId: number) {
        this.container = container;
        this.port = port;
        this.windowId = windowId;
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

        const rootContainer = document.createElement('div');
        rootContainer.className = 'flex flex-col';

        for (const rootId of state.rootIds) {
            const nodeElement = this.renderNode(rootId, state.tree, state.tabsById, state.collapsedNodes);
            rootContainer.appendChild(nodeElement);
        }

        this.container.appendChild(rootContainer);
        this.container.appendChild(this.renderAddButton());
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

    private renderNode(nodeId: number, tree: TabTree, tabsById: Map<number, browser.Tabs.Tab>, collapsedNodes: Set<number>): HTMLDivElement {
        const node = tree.get(nodeId)!;
        const nodeWrapper = document.createElement('div');
        nodeWrapper.dataset.tabId = String(node.id);

        const nodeElement = document.createElement('div');
        nodeElement.className = 'tree-node';
        nodeElement.draggable = true;

        const tab = tabsById.get(node.id);
        if (tab?.discarded) nodeElement.classList.add('discarded-tab');
        if (tab?.active) nodeElement.classList.add('focused-tab');

        nodeElement.addEventListener('click', () => this.sendMessage({ type: 'FOCUS_TAB', payload: { tabId: node.id } }));
        nodeElement.addEventListener('mousedown', (event) => {
            if (event.button === 1) {
                event.preventDefault();
                this.sendMessage({ type: 'CLOSE_SINGLE_TAB', payload: { tabId: node.id } });
            }
        });
        nodeElement.addEventListener('contextmenu', (e) => { e.preventDefault(); this.showContextMenu(e.clientX, e.clientY, node.id); });

        nodeElement.addEventListener('dragstart', (event) => {
            const movedTabIds = this.getTabSubtreeIds(node.id, tree);
            const parentMapSnapshot: Record<number, number | undefined> = {};
            for (const id of movedTabIds) {
                const n = tree.get(id);
                if (n) parentMapSnapshot[id] = n.parentId;
            }
            const collapsedInSubtree = movedTabIds.filter(id => collapsedNodes.has(id));

            if (!tab || tab.windowId === undefined) { event.preventDefault(); return; }

            const dragData: DragData = {
                draggedTabId: node.id,
                sourceWindowId: tab.windowId,
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

            const types = dataTransfer.types;
            if (types.includes('application/json')) {
                const dragDataStr = dataTransfer.getData('application/json');
                if (!dragDataStr) return;
                const dragData: DragData = JSON.parse(dragDataStr);

                this.currentDragData = null;
                if (dragData.movedTabIds.includes(node.id)) return;

                if (dragData.sourceWindowId !== this.windowId) {
                    this.sendMessage({ type: 'APPLY_PENDING_DATA', payload: { dragData, windowId: this.windowId } });
                }
                this.sendMessage({ type: 'HANDLE_DROP', payload: { dragData, targetTabId: node.id, action, windowId: this.windowId } });
            } else if (types.includes('text/uri-list') || types.includes('text/plain')) {
                const url = this.getUrlFromDataTransfer(dataTransfer);
                if (!url || !this.currentRenderState) return;

                const { tree, tabsById } = this.currentRenderState;
                const targetNode = tree.get(nodeId);
                if (!targetNode) return;

                let index: number | undefined;
                let parentId: number | undefined;

                switch (action) {
                    case 'above':
                        index = tabsById.get(nodeId)?.index;
                        parentId = targetNode.parentId;
                        break;
                    case 'below':
                        index = this.findLastDescendantIndex(nodeId, tree, tabsById) + 1;
                        parentId = targetNode.parentId;
                        break;
                    case 'inside':
                    default:
                        index = this.findLastDescendantIndex(nodeId, tree, tabsById) + 1;
                        parentId = nodeId;
                        break;
                }
                this.sendMessage({ type: 'CREATE_TAB_FROM_URL', payload: { url, windowId: this.windowId, index, parentId } });
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
                this.sendMessage({ type: 'TOGGLE_COLLAPSE', payload: { nodeId: node.id, windowId: this.windowId } });
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
        icon.src = node.favIconUrl || DEFAULT_FAVICON_URL;
        icon.onerror = () => { if (icon.src !== DEFAULT_FAVICON_URL) icon.src = DEFAULT_FAVICON_URL; };
        icon.className = 'tree-node-icon';
        const title = document.createElement('span');
        title.className = 'tree-node-title';
        title.textContent = node.title;
        contentWrapper.append(icon, title);

        const closeButton = document.createElement('button');
        closeButton.className = 'close-tab-button';
        closeButton.textContent = '⨯';
        closeButton.addEventListener('click', (e) => { e.stopPropagation(); this.sendMessage({ type: 'CLOSE_SINGLE_TAB', payload: { tabId: node.id } }); });

        nodeElement.append(collapseContainer, contentWrapper, closeButton);
        nodeWrapper.appendChild(nodeElement);

        if (node.children.length > 0) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'children-container';
            if (collapsedNodes.has(nodeId)) {
                childrenContainer.classList.add('hidden');
            }
            for (const childId of node.children) {
                childrenContainer.appendChild(this.renderNode(childId, tree, tabsById, collapsedNodes));
            }
            nodeWrapper.appendChild(childrenContainer);
        }

        return nodeWrapper;
    }

    private renderAddButton(): HTMLDivElement {
        const button = document.createElement('div');
        button.className = 'add-tab-button';
        button.textContent = '+';
        button.addEventListener('click', () => this.sendMessage({ type: 'CREATE_TAB', payload: { windowId: this.windowId } }));

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
            if (!dataTransfer) return;

            const types = dataTransfer.types;
            if (types.includes('application/json')) {
                const dragDataStr = dataTransfer.getData('application/json');
                if (!dragDataStr) return;
                const dragData: DragData = JSON.parse(dragDataStr);
                this.currentDragData = null;
                if (dragData.sourceWindowId !== this.windowId) {
                    this.sendMessage({ type: 'APPLY_PENDING_DATA', payload: { dragData, windowId: this.windowId } });
                }
                this.sendMessage({ type: 'HANDLE_DROP', payload: { dragData, targetTabId: -1, action: 'root', windowId: this.windowId } });
            } else if (types.includes('text/uri-list') || types.includes('text/plain')) {
                const url = this.getUrlFromDataTransfer(dataTransfer);
                if (!url) return;
                this.sendMessage({ type: 'CREATE_TAB_FROM_URL', payload: { url, windowId: this.windowId, index: -1 } });
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

    private showContextMenu(x: number, y: number, tabId: number) {
        this.removeContextMenu();
        if (!this.currentRenderState) return;

        const menu = document.createElement('div');
        menu.id = 'tab-context-menu';
        menu.className = 'context-menu';
        menu.style.visibility = 'hidden';
        menu.addEventListener('click', (e) => e.stopPropagation());

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

        createItem('Duplicate Tab', ICON_DUPLICATE, () => this.sendMessage({ type: 'DUPLICATE_TAB_SMART', payload: { tabId } }));
        createSeparator();

        const tab = this.currentRenderState.tabsById.get(tabId);
        if (tab?.discarded) {
            createItem('Load Tree', ICON_LOAD, () => this.sendMessage({ type: 'LOAD_TREE', payload: { tabId } }));
        } else {
            createItem('Unload Tab', ICON_UNLOAD, () => this.sendMessage({ type: 'UNLOAD_TAB', payload: { tabId } }));
        }

        const node = this.currentRenderState.tree.get(tabId);
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

        createItem('Copy URL', ICON_COPY, () => this.copyUrl(tabId));

        document.body.appendChild(menu);

        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        const viewWidth = document.documentElement.clientWidth;
        const viewHeight = document.documentElement.clientHeight;

        let finalX = x;
        let finalY = y;

        if (x + menuWidth > viewWidth) {
            finalX = viewWidth - menuWidth - 5;
        }

        if (y + menuHeight > viewHeight) {
            finalY = viewHeight - menuHeight - 5;
        }

        finalX = Math.max(5, finalX);
        finalY = Math.max(5, finalY);

        menu.style.left = `${finalX}px`;
        menu.style.top = `${finalY}px`;
        menu.style.visibility = 'visible';

        setTimeout(() => {
            document.addEventListener('click', this.removeContextMenu, { once: true });
            document.addEventListener('contextmenu', this.removeContextMenu, { once: true });
            window.addEventListener('blur', this.removeContextMenu, { once: true });
        }, 0);
    }
}
