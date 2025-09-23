import './tab_tree_view.css';
import browser from 'webextension-polyfill';
import type { DragData, TabTree, BackgroundRequest, UiStateForRender, DropAction } from './types';

const DEFAULT_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0-0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
const DEFAULT_FAVICON_URL = `data:image/svg+xml;base64,${btoa(DEFAULT_FAVICON)}`;

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

    private extractUrlFromPlainText(text: string): string | null {
        if (!text) return null;
        const trimmedText = text.trim();
        try {
            new URL(trimmedText);
            return trimmedText;
        } catch (e) {
            if (!trimmedText.includes(' ') && trimmedText.includes('.')) {
                try {
                    const potentialUrl = 'https://' + trimmedText;
                    new URL(potentialUrl);
                    return potentialUrl;
                } catch (e2) {
                    return null;
                }
            }
        }
        return null;
    }

    private getUrlFromDataTransfer(dataTransfer: DataTransfer): string | null {
        const uriList = dataTransfer.getData('text/uri-list');
        if (uriList) {
            const lines = uriList.split(/[\r\n]+/);
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#')) {
                    return this.extractUrlFromPlainText(trimmedLine);
                }
            }
        }
        const plainText = dataTransfer.getData('text/plain');
        if (plainText) {
            return this.extractUrlFromPlainText(plainText);
        }
        return null;
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

            const types = event.dataTransfer?.types;
            const dataTransfer = event.dataTransfer;

            if (types?.includes('application/json') && dataTransfer) {
                const dragDataStr = dataTransfer.getData('application/json');
                if (!dragDataStr) return;
                const dragData: DragData = JSON.parse(dragDataStr);

                this.currentDragData = null;
                if (dragData.movedTabIds.includes(node.id)) return;

                if (dragData.sourceWindowId !== this.windowId) {
                    this.sendMessage({ type: 'APPLY_PENDING_DATA', payload: { dragData, windowId: this.windowId } });
                }
                this.sendMessage({ type: 'HANDLE_DROP', payload: { dragData, targetTabId: node.id, action, windowId: this.windowId } });
            } else if ((types?.includes('text/uri-list') || types?.includes('text/plain')) && dataTransfer) {
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
        button.addEventListener('drop', (event) => {
            event.preventDefault();
            button.classList.remove('drag-over-target');
            const dataTransfer = event.dataTransfer;
            const types = dataTransfer?.types;

            if (types?.includes('application/json') && dataTransfer) {
                const dragDataStr = dataTransfer.getData('application/json');
                if (!dragDataStr) return;
                const dragData: DragData = JSON.parse(dragDataStr);
                this.currentDragData = null;
                if (dragData.sourceWindowId !== this.windowId) {
                    this.sendMessage({ type: 'APPLY_PENDING_DATA', payload: { dragData, windowId: this.windowId } });
                }
                this.sendMessage({ type: 'HANDLE_DROP', payload: { dragData, targetTabId: -1, action: 'root', windowId: this.windowId } });
            } else if ((types?.includes('text/uri-list') || types?.includes('text/plain')) && dataTransfer) {
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
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.addEventListener('click', (e) => e.stopPropagation());

        const createItem = (label: string, action: () => void) => {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            item.textContent = label;
            item.addEventListener('click', () => { action(); this.removeContextMenu(); });
            menu.appendChild(item);
        };

        createItem('Duplicate Tab', () => this.sendMessage({ type: 'DUPLICATE_TAB_SMART', payload: { tabId } }));

        const tab = this.currentRenderState.tabsById.get(tabId);
        if (tab?.discarded) {
            createItem('Load Tree', () => this.sendMessage({ type: 'LOAD_TREE', payload: { tabId } }));
        } else {
            createItem('Unload Tab', () => this.sendMessage({ type: 'UNLOAD_TAB', payload: { tabId } }));
        }

        const node = this.currentRenderState.tree.get(tabId);
        if (node && node.children.length > 0) {
            if (!tab?.discarded) {
                createItem('Unload Tree', () => this.sendMessage({ type: 'UNLOAD_TREE', payload: { tabId } }));
            }
            createItem('Close Tree', () => this.sendMessage({ type: 'CLOSE_SUBTREE', payload: { tabId } }));
        }

        createItem('Close Tab Only', () => this.sendMessage({ type: 'CLOSE_SINGLE_TAB', payload: { tabId } }));
        createItem('Copy URL', () => this.copyUrl(tabId));
        createItem('Move to New Window', () => this.sendMessage({ type: 'MOVE_SUBTREE_TO_NEW_WINDOW', payload: { rootTabId: tabId } }));

        document.body.appendChild(menu);
        setTimeout(() => {
            document.addEventListener('click', this.removeContextMenu, { once: true });
            document.addEventListener('contextmenu', this.removeContextMenu, { once: true });
        }, 0);
    }
}
