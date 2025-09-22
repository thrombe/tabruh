import './sidebar.css';
import browser from 'webextension-polyfill';

type TabNode = {
    id: number;
    title: string;
    url: string;
    favIconUrl?: string;
    parentId?: number;
    children: number[];
};

type DragData = {
    draggedTabId: number;
    sourceWindowId: number;
    movedTabIds: number[];
    parentMapSnapshot: Record<number, number | undefined>;
    collapsed: number[];
};


type TabTree = Map<number, TabNode>;

const DEFAULT_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
const DEFAULT_FAVICON_URL = `data:image/svg+xml;base64,${btoa(DEFAULT_FAVICON)}`;

class TabTreeSidebar {
    container: HTMLElement;
    tree: TabTree;
    tabsById: Map<number, browser.Tabs.Tab>;
    parent_map: Map<number, number>;
    private collapsedNodes: Set<number>;
    private currentDragData: DragData | null = null;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) {
            throw new Error(`Sidebar container #${containerId} not found.`);
        }
        this.container = el;
        this.parent_map = new Map();
        this.tree = new Map();
        this.tabsById = new Map();
        this.collapsedNodes = new Set();

        this.init();
    }

    private async init() {
        await this.applyPendingParentData();
        await this.render();
        this.attachListeners();
    }

    private async applyPendingParentData() {
        try {
            const result = await browser.storage.local.get('tabTreeParentTransfer');
            const transferData = result.tabTreeParentTransfer as { targetWindowId: number, map: Record<string, number>, collapsed?: number[] };
            if (!transferData) return;

            const currentWindow = await browser.windows.getCurrent();
            if (transferData.targetWindowId === currentWindow.id) {
                for (const [childId, parentId] of Object.entries(transferData.map)) {
                    if (parentId !== undefined && parentId !== null) {
                        this.parent_map.set(Number(childId), parentId as number);
                    }
                }
                if (transferData.collapsed) {
                    for (const id of transferData.collapsed) {
                        this.collapsedNodes.add(id);
                    }
                }
                await browser.storage.local.remove('tabTreeParentTransfer');
            }
        } catch (e) {
            console.error('Failed to apply pending parent data:', e);
        }
    }


    private attachListeners() {
        const refresh = () => this.render();

        browser.tabs.onCreated.addListener(refresh);
        browser.tabs.onRemoved.addListener(refresh);
        browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
            if (changeInfo.status || changeInfo.title || changeInfo.favIconUrl || 'discarded' in changeInfo) {
                refresh();
            }
        });
        browser.tabs.onMoved.addListener(refresh);
        browser.tabs.onAttached.addListener(refresh);
        browser.tabs.onDetached.addListener(refresh);
    }

    getParent(tab: browser.Tabs.Tab): number | undefined {
        if (tab.id === undefined) return undefined;
        const parent = this.parent_map.get(tab.id);
        if (parent === -1) return undefined;
        if (parent === undefined) return tab.openerTabId;
        return parent;
    }

    setParent(id: number, parent: number) {
        this.parent_map.set(id, parent);
    }

    isDescendant(elim: number, maybe_child: number): boolean {
        const parent = this.tree.get(maybe_child)?.parentId;
        if (parent === elim) return true;
        if (parent === undefined) return false;
        return this.isDescendant(elim, parent);
    }

    private async render() {
        const tabs = await browser.tabs.query({ currentWindow: true });
        const { nodes, rootIds, tabsById } = this.buildTabTree(tabs);

        this.container.innerHTML = '';
        this.tree = nodes;
        this.tabsById = tabsById;

        const rootContainer = document.createElement('div');
        rootContainer.className = 'flex flex-col';

        for (const rootId of rootIds) {
            const nodeElement = this.renderNode(rootId, nodes);
            rootContainer.appendChild(nodeElement);
        }

        this.container.appendChild(rootContainer);
        this.container.appendChild(this.renderAddButton());
    }

    private buildTabTree(tabs: browser.Tabs.Tab[]): { nodes: TabTree, rootIds: number[], tabsById: Map<number, browser.Tabs.Tab> } {
        const nodes: TabTree = new Map();
        const rootIds: number[] = [];

        const tabsById = new Map<number, browser.Tabs.Tab>();
        for (const tab of tabs) {
            if (tab.id !== undefined) {
                tabsById.set(tab.id, tab);
            }
        }

        const sortedTabs = [...tabsById.values()].sort((a, b) => a.index - b.index);

        for (const tab of sortedTabs) {
            if (tab.id === undefined) continue;
            nodes.set(tab.id, {
                id: tab.id,
                title: tab.title ?? 'Untitled',
                url: tab.url ?? '',
                favIconUrl: tab.favIconUrl,
                parentId: this.getParent(tab),
                children: [],
            });
        }

        for (const node of nodes.values()) {
            const tab = tabsById.get(node.id)!;
            const parentId = this.getParent(tab);

            if (parentId !== undefined && nodes.has(parentId)) {
                nodes.get(parentId)!.children.push(node.id);
            } else {
                rootIds.push(node.id);
            }
        }

        return { nodes, rootIds, tabsById };
    }

    private getTabSubtreeIds(rootId: number): number[] {
        const subtreeIds: number[] = [];
        const queue = [rootId];
        const visited = new Set<number>();

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            if (visited.has(currentId)) continue;
            visited.add(currentId);

            subtreeIds.push(currentId);

            const node = this.tree.get(currentId);
            if (node) {
                queue.push(...node.children);
            }
        }
        return subtreeIds;
    }


    private countAllDescendants(nodeId: number): number {
        const node = this.tree.get(nodeId);
        if (!node) return 0;

        let count = 0;
        const queue = [...node.children];
        while (queue.length > 0) {
            const currentId = queue.shift()!;
            count++;
            const currentNode = this.tree.get(currentId);
            if (currentNode && currentNode.children.length > 0) {
                queue.push(...currentNode.children);
            }
        }
        return count;
    }

    private renderNode(nodeId: number, nodes: TabTree): HTMLDivElement {
        const node = nodes.get(nodeId)!;

        const nodeWrapper = document.createElement('div');
        nodeWrapper.dataset.tabId = String(node.id);

        const nodeElement = document.createElement('div');
        nodeElement.className = 'tree-node';
        nodeElement.draggable = true; // ✅ only drag the visual node

        const tab = this.tabsById.get(node.id);
        if (tab?.discarded) {
            nodeElement.classList.add('discarded-tab');
        }

        nodeElement.addEventListener('click', () => this.focusTab(node.id));

        nodeElement.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            this.showContextMenu(event.clientX, event.clientY, node.id);
        });


        nodeElement.addEventListener('dragstart', (event) => {
            const movedTabIds = this.getTabSubtreeIds(node.id);
            const parentMapSnapshot: Record<number, number | undefined> = {};
            for (const id of movedTabIds) {
                const tab = this.tabsById.get(id);
                if (tab) {
                    parentMapSnapshot[id] = this.getParent(tab);
                }
            }
            const collapsedInSubtree = movedTabIds.filter(id => this.collapsedNodes.has(id));

            const draggedTab = this.tabsById.get(node.id);
            if (!draggedTab || draggedTab.windowId === undefined) {
                console.error("Could not get source window ID, cancelling drag.");
                event.preventDefault();
                return;
            }

            const dragData: DragData = {
                draggedTabId: node.id,
                sourceWindowId: draggedTab.windowId,
                movedTabIds,
                parentMapSnapshot,
                collapsed: collapsedInSubtree
            };
            this.currentDragData = dragData;

            event.dataTransfer!.setData('application/json', JSON.stringify(dragData));
            event.dataTransfer!.effectAllowed = 'move';
            setTimeout(() => {
                nodeElement.classList.add('dragging');
            }, 0);
        });

        nodeElement.addEventListener('dragend', (event) => {
            nodeElement.classList.remove('dragging');
            if (event.dataTransfer?.dropEffect === 'none' && this.currentDragData) {
                this.moveSubtreeToNewWindow(this.currentDragData.draggedTabId);
            }
            this.currentDragData = null;
        });

        nodeElement.addEventListener('dragover', (event) => {
            event.preventDefault();
            const dragDataStr = event.dataTransfer?.getData('application/json');
            if (!dragDataStr) return;

            const dragData: DragData = JSON.parse(dragDataStr);
            if (dragData.movedTabIds.includes(node.id)) {
                return;
            }

            const rect = nodeElement.getBoundingClientRect();
            const y = event.clientY - rect.top;
            const height = rect.height;

            nodeElement.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');

            if (y < height * 0.25) {
                nodeElement.classList.add('drag-over-above');
                nodeElement.dataset.dropAction = 'above';
            } else if (y > height * 0.75) {
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
            event.preventDefault();
            event.stopPropagation();
            const dragDataStr = event.dataTransfer?.getData('application/json');
            if (!dragDataStr) return;

            const dragData: DragData = JSON.parse(dragDataStr);
            const targetTabId = node.id;
            this.currentDragData = null;

            if (dragData.movedTabIds.includes(targetTabId)) return;

            const currentWindow = await browser.windows.getCurrent();
            if (dragData.sourceWindowId !== currentWindow.id) {
                for (const [childId, parentId] of Object.entries(dragData.parentMapSnapshot)) {
                    if (parentId !== undefined && parentId !== null) {
                        this.parent_map.set(Number(childId), parentId);
                    }
                }
                if (dragData.collapsed) {
                    for (const id of dragData.collapsed) {
                        this.collapsedNodes.add(id);
                    }
                }
            }

            const action = nodeElement.dataset.dropAction;
            switch (action) {
                case 'above':
                    this.moveSubtreeAbove(dragData, targetTabId);
                    break;
                case 'below':
                    this.moveSubtreeBelow(dragData, targetTabId);
                    break;
                case 'inside':
                default:
                    this.makeSubtreeChild(dragData, targetTabId);
                    break;
            }

            nodeElement.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
            delete nodeElement.dataset.dropAction;

            await this.render();
        });

        const collapseContainer = document.createElement('div');
        collapseContainer.className = 'collapse-container';

        if (node.children.length > 0) {
            const collapseButton = document.createElement('button');
            collapseButton.className = 'collapse-button';
            collapseButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="arrow-svg"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
            collapseButton.addEventListener('click', (event) => {
                event.stopPropagation();
                this.toggleCollapse(node.id);
            });

            if (this.collapsedNodes.has(nodeId)) {
                collapseButton.classList.add('collapsed');
                const descendantCount = this.countAllDescendants(nodeId);
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
        icon.onerror = () => {
            if (icon.src !== DEFAULT_FAVICON_URL) {
                icon.src = DEFAULT_FAVICON_URL;
            }
        };
        icon.alt = 'favicon';
        icon.className = 'tree-node-icon';

        const title = document.createElement('span');
        title.className = 'tree-node-title';
        title.textContent = node.title;

        contentWrapper.appendChild(icon);
        contentWrapper.appendChild(title);

        const closeButton = document.createElement('button');
        closeButton.className = 'close-tab-button';
        closeButton.textContent = '⨯';
        closeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            this.closeTab(node.id);
        });

        nodeElement.appendChild(collapseContainer);
        nodeElement.appendChild(contentWrapper);
        nodeElement.appendChild(closeButton);
        nodeWrapper.appendChild(nodeElement);

        if (node.children.length > 0) {
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'children-container';
            if (this.collapsedNodes.has(nodeId)) {
                childrenContainer.classList.add('hidden');
            }
            for (const childId of node.children) {
                const childElement = this.renderNode(childId, nodes);
                childrenContainer.appendChild(childElement);
            }
            nodeWrapper.appendChild(childrenContainer);
        }

        return nodeWrapper;
    }

    private renderAddButton(): HTMLDivElement {
        const button = document.createElement('div');
        button.className = 'add-tab-button';
        button.textContent = '+';

        button.addEventListener('click', () => {
            browser.tabs.create({});
        });

        button.addEventListener('dragover', (event) => {
            event.preventDefault();
            const draggedId = event.dataTransfer?.getData('application/json');
            if (draggedId) {
                event.dataTransfer!.dropEffect = 'move';
                button.classList.add('drag-over-target');
            }
        });

        button.addEventListener('dragleave', () => {
            button.classList.remove('drag-over-target');
        });

        button.addEventListener('drop', async (event) => {
            event.preventDefault();
            button.classList.remove('drag-over-target');
            this.currentDragData = null;

            const dragDataStr = event.dataTransfer?.getData('application/json');
            if (!dragDataStr) return;
            const dragData: DragData = JSON.parse(dragDataStr);

            const currentWindow = await browser.windows.getCurrent();
            if (dragData.sourceWindowId !== currentWindow.id) {
                for (const [childId, parentId] of Object.entries(dragData.parentMapSnapshot)) {
                    if (parentId !== undefined && parentId !== null) {
                        this.parent_map.set(Number(childId), parentId);
                    }
                }
            }

            this.moveSubtreeToRoot(dragData);

            await this.render();
        });

        return button;
    }

    private async focusTab(tabId: number) {
        try {
            const tab = await browser.tabs.get(tabId);
            if (!tab.discarded) {
                if (tab.windowId) {
                    await browser.windows.update(tab.windowId, { focused: true });
                }
                await browser.tabs.update(tabId, { active: true });
            } else {
                // Discarded tabs cannot be focused directly, they need to be reloaded first.
                // The browser usually handles this when you try to switch to it.
                // Here we simply activate it, letting the browser handle the reload.
                await browser.tabs.update(tabId, { active: true });
            }
        } catch (e) {
            console.error(`Could not focus tab ${tabId}:`, e);
        }
    }

    private async closeTab(tabId: number) {
        try {
            const idsToClose = this.getTabSubtreeIds(tabId);
            await browser.tabs.remove(idsToClose);
        } catch (e) {
            console.error(`Could not close tab ${tabId} and its children:`, e);
        }
    }

    private async moveSubtreeToRoot(dragData: DragData) {
        try {
            this.parent_map.set(dragData.draggedTabId, -1);
            await browser.tabs.move(dragData.movedTabIds, { index: -1 });
        } catch (e) {
            console.error('Failed to move subtree to root:', e);
        }
    }

    private findLastDescendantIndexInFlatList(startNodeId: number): number {
        const startTab = this.tabsById.get(startNodeId);
        if (!startTab) {
            throw new Error(`Tab ${startNodeId} not found in cache.`);
        }

        let maxIndex = startTab.index;
        const subtreeIds = this.getTabSubtreeIds(startNodeId);

        for (const id of subtreeIds) {
            const tab = this.tabsById.get(id);
            if (tab && tab.index > maxIndex) {
                maxIndex = tab.index;
            }
        }
        return maxIndex;
    }

    private async makeSubtreeChild(dragData: DragData, targetTabId: number) {
        try {
            const index = this.findLastDescendantIndexInFlatList(targetTabId) + 1;
            this.setParent(dragData.draggedTabId, targetTabId);
            await browser.tabs.move(dragData.movedTabIds, { index, windowId: (await browser.windows.getCurrent()).id });
        } catch (e) {
            console.error('Failed to make tab a child:', e);
        }
    }

    private async moveSubtreeAbove(dragData: DragData, targetTabId: number) {
        try {
            const targetTab = this.tabsById.get(targetTabId);
            if (!targetTab) return;

            const targetNode = this.tree.get(targetTabId);
            if (targetNode?.parentId) {
                this.setParent(dragData.draggedTabId, targetNode.parentId);
            } else {
                this.parent_map.set(dragData.draggedTabId, -1);
            }
            await browser.tabs.move(dragData.movedTabIds, { index: targetTab.index, windowId: (await browser.windows.getCurrent()).id });
        } catch (e) {
            console.error('Failed to move tab above:', e);
        }
    }

    private async moveSubtreeBelow(dragData: DragData, targetTabId: number) {
        try {
            const targetTab = this.tabsById.get(targetTabId);
            const targetNode = this.tree.get(targetTabId);
            if (!targetTab || !targetNode) return;

            const index = this.findLastDescendantIndexInFlatList(targetTabId) + 1;

            if (targetNode.parentId) {
                this.setParent(dragData.draggedTabId, targetNode.parentId);
            } else {
                this.parent_map.set(dragData.draggedTabId, -1);
            }
            await browser.tabs.move(dragData.movedTabIds, { index, windowId: (await browser.windows.getCurrent()).id });
        } catch (e) {
            console.error('Failed to move tab below:', e);
        }
    }


    private toggleCollapse(nodeId: number) {
        const nodeWrapper = this.container.querySelector(`[data-tab-id='${nodeId}']`);
        if (!nodeWrapper) return;

        const childrenContainer = nodeWrapper.querySelector('.children-container');
        const collapseButton = nodeWrapper.querySelector<HTMLButtonElement>('.collapse-button');
        if (!collapseButton) return;

        const existingCount = collapseButton.querySelector('.collapsed-count');
        if (existingCount) {
            existingCount.remove();
        }

        if (this.collapsedNodes.has(nodeId)) {
            this.collapsedNodes.delete(nodeId);
            childrenContainer?.classList.remove('hidden');
            collapseButton.classList.remove('collapsed');
        } else {
            this.collapsedNodes.add(nodeId);
            childrenContainer?.classList.add('hidden');
            collapseButton.classList.add('collapsed');

            const descendantCount = this.countAllDescendants(nodeId);
            if (descendantCount > 0) {
                const countSpan = document.createElement('span');
                countSpan.className = 'collapsed-count';
                countSpan.textContent = String(descendantCount);
                collapseButton.appendChild(countSpan);
            }
        }
    }

    private removeContextMenu = () => {
        const menu = document.getElementById('tab-context-menu');
        if (menu) {
            menu.remove();
        }
        document.removeEventListener('click', this.removeContextMenu);
        document.removeEventListener('contextmenu', this.removeContextMenu);
    }

    private showContextMenu(x: number, y: number, tabId: number) {
        this.removeContextMenu();

        const menu = document.createElement('div');
        menu.id = 'tab-context-menu';
        menu.className = 'context-menu';
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        menu.addEventListener('click', (e) => e.stopPropagation());

        const options = [
            { label: 'Duplicate Tab', action: () => this.duplicateTab(tabId) },
            { label: 'Unload Tab', action: () => this.unloadTab(tabId) },
        ];

        const node = this.tree.get(tabId);
        if (node && node.children.length > 0) {
            options.push({ label: 'Unload Tree', action: () => this.unloadTree(tabId) });
        }

        options.push(
            { label: 'Copy URL', action: () => this.copyUrl(tabId) },
            { label: 'Move to New Window', action: () => this.moveSubtreeToNewWindow(tabId) }
        );


        options.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            item.textContent = opt.label;
            item.addEventListener('click', () => {
                opt.action();
                this.removeContextMenu();
            });
            menu.appendChild(item);
        });

        document.body.appendChild(menu);

        setTimeout(() => {
            document.addEventListener('click', this.removeContextMenu, { once: true });
            document.addEventListener('contextmenu', this.removeContextMenu, { once: true });
        }, 0);
    }

    private async duplicateTab(tabId: number) {
        try {
            await browser.tabs.duplicate(tabId);
        } catch (e) {
            console.error('Failed to duplicate tab:', e);
        }
    }

    private async unloadTab(tabId: number) {
        try {
            await browser.tabs.discard(tabId);
        } catch (e) {
            console.error('Failed to unload/discard tab:', e);
        }
    }

    private async unloadTree(tabId: number) {
        try {
            const idsToDiscard = this.getTabSubtreeIds(tabId);
            await browser.tabs.discard(idsToDiscard);
        } catch (e) {
            console.error(`Could not unload tree for tab ${tabId}:`, e);
        }
    }

    private async copyUrl(tabId: number) {
        try {
            const tab = this.tabsById.get(tabId);
            if (tab?.url) {
                await navigator.clipboard.writeText(tab.url);
            }
        } catch (e) {
            console.error('Failed to copy URL:', e);
        }
    }

    private async moveSubtreeToNewWindow(rootTabId: number) {
        const movedTabIds = this.getTabSubtreeIds(rootTabId);
        if (movedTabIds.length === 0) return;

        try {
            const newWindow = await browser.windows.create({ tabId: rootTabId });
            const otherTabIds = movedTabIds.filter(id => id !== rootTabId);

            if (otherTabIds.length > 0) {
                await browser.tabs.move(otherTabIds, { windowId: newWindow.id, index: -1 });
            }

            const parentMapSnapshot: Record<number, number | undefined> = {};
            for (const id of movedTabIds) {
                const tab = this.tabsById.get(id);
                if (tab) {
                    parentMapSnapshot[id] = this.getParent(tab);
                }
            }

            if (Object.keys(parentMapSnapshot).length > 0 && newWindow.id) {
                const collapsedInSubtree = movedTabIds.filter(id => this.collapsedNodes.has(id));
                await browser.storage.local.set({
                    tabTreeParentTransfer: {
                        targetWindowId: newWindow.id,
                        map: parentMapSnapshot,
                        collapsed: collapsedInSubtree
                    }
                });
            }
        } catch (e) {
            console.error('Failed to move subtree to new window:', e);
        }
    }
}


document.addEventListener('DOMContentLoaded', () => {
    new TabTreeSidebar('tree-container');
});
