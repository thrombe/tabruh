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

type TabTree = Map<number, TabNode>;

const DEFAULT_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
const DEFAULT_FAVICON_URL = `data:image/svg+xml;base64,${btoa(DEFAULT_FAVICON)}`;

class TabTreeSidebar {
    container: HTMLElement;
    tree: TabTree;
    tabsById: Map<number, browser.Tabs.Tab>;
    parent_map: Map<number, number>;
    private collapsedNodes: Set<number>;

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
        await this.render();
        this.attachListeners();
    }

    private attachListeners() {
        const refresh = () => this.render();

        browser.tabs.onCreated.addListener(refresh);
        browser.tabs.onRemoved.addListener(refresh);
        browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
            if (changeInfo.status || changeInfo.title || changeInfo.favIconUrl) {
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

        nodeElement.addEventListener('click', () => this.focusTab(node.id));

        nodeElement.addEventListener('dragstart', (event) => {
            event.dataTransfer!.setData('text/plain', String(node.id));
            event.dataTransfer!.effectAllowed = 'move';
            setTimeout(() => {
                nodeElement.classList.add('dragging');
            }, 0);
        });

        nodeElement.addEventListener('dragend', () => {
            nodeElement.classList.remove('dragging');
        });

        nodeElement.addEventListener('dragover', (event) => {
            event.preventDefault();
            const draggedIdStr = event.dataTransfer?.getData('text/plain');
            if (!draggedIdStr) return;
            const draggedId = parseInt(draggedIdStr, 10);
            if (draggedId === node.id || this.isDescendant(draggedId, node.id)) {
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

        nodeElement.addEventListener('drop', (event) => {
            event.preventDefault();
            const draggedTabIdStr = event.dataTransfer?.getData('text/plain');
            if (!draggedTabIdStr) return;
            const draggedTabId = parseInt(draggedTabIdStr, 10);
            const targetTabId = node.id;

            if (draggedTabId === targetTabId || this.isDescendant(draggedTabId, targetTabId)) {
                return;
            }

            const action = nodeElement.dataset.dropAction;
            switch (action) {
                case 'above':
                    this.moveTabAbove(draggedTabId, targetTabId);
                    break;
                case 'below':
                    this.moveTabBelow(draggedTabId, targetTabId);
                    break;
                case 'inside':
                default:
                    this.makeTabChild(draggedTabId, targetTabId);
                    break;
            }

            nodeElement.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
            delete nodeElement.dataset.dropAction;

            this.render();
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
            const draggedId = event.dataTransfer?.getData('text/plain');
            if (draggedId) {
                event.dataTransfer!.dropEffect = 'move';
                button.classList.add('drag-over-target');
            }
        });

        button.addEventListener('dragleave', () => {
            button.classList.remove('drag-over-target');
        });

        button.addEventListener('drop', (event) => {
            event.preventDefault();
            button.classList.remove('drag-over-target');

            const draggedTabIdStr = event.dataTransfer?.getData('text/plain');
            if (!draggedTabIdStr) return;

            const draggedTabId = parseInt(draggedTabIdStr, 10);
            this.moveTabToRoot(draggedTabId);

            this.render();
        });

        return button;
    }


    private async focusTab(tabId: number) {
        try {
            const tab = await browser.tabs.get(tabId);
            if (tab.windowId) {
                await browser.windows.update(tab.windowId, { focused: true });
            }
            await browser.tabs.update(tabId, { active: true });
        } catch (e) {
            console.error(`Could not focus tab ${tabId}:`, e);
        }
    }

    private async closeTab(tabId: number) {
        try {
            await browser.tabs.remove(tabId);
        } catch (e) {
            console.error(`Could not close tab ${tabId}:`, e);
        }
    }

    private async moveTabToRoot(tabId: number) {
        try {
            this.parent_map.set(tabId, -1);
            await browser.tabs.move(tabId, { index: -1 });
        } catch (e) {
            console.error('Failed to move tab to root:', e);
        }
    }

    private findLastDescendantIndexInFlatList(startNodeId: number): number {
        const startTab = this.tabsById.get(startNodeId);
        if (!startTab) {
            throw new Error(`Tab ${startNodeId} not found in cache.`);
        }

        let maxIndex = startTab.index;
        const searchQueue: number[] = [startNodeId];
        const visited: Set<number> = new Set();

        while (searchQueue.length > 0) {
            const currentId = searchQueue.pop()!;
            if (visited.has(currentId)) continue;
            visited.add(currentId);

            const currentNode = this.tree.get(currentId);
            if (!currentNode) continue;

            const currentTab = this.tabsById.get(currentId);
            if (currentTab && currentTab.index > maxIndex) {
                maxIndex = currentTab.index;
            }

            for (const childId of currentNode.children) {
                searchQueue.push(childId);
            }
        }
        return maxIndex;
    }

    private async makeTabChild(draggedTabId: number, targetTabId: number) {
        try {
            const index = this.findLastDescendantIndexInFlatList(targetTabId) + 1;
            this.setParent(draggedTabId, targetTabId);
            await browser.tabs.move(draggedTabId, { index });
        } catch (e) {
            console.error('Failed to make tab a child:', e);
        }
    }

    private async moveTabAbove(draggedTabId: number, targetTabId: number) {
        try {
            const targetTab = this.tabsById.get(targetTabId);
            if (!targetTab) return;

            const targetNode = this.tree.get(targetTabId);
            if (targetNode?.parentId) {
                this.setParent(draggedTabId, targetNode.parentId);
            } else {
                this.parent_map.set(draggedTabId, -1);
            }
            await browser.tabs.move(draggedTabId, { index: targetTab.index });
        } catch (e) {
            console.error('Failed to move tab above:', e);
        }
    }

    private async moveTabBelow(draggedTabId: number, targetTabId: number) {
        try {
            const targetTab = this.tabsById.get(targetTabId);
            if (!targetTab) return;
            const targetNode = this.tree.get(targetTabId);
            if (!targetNode) return;
            let index = this.findLastDescendantIndexInFlatList(targetTabId);

            if (targetTab.index < this.tabsById.get(draggedTabId)!.index && !this.isDescendant(index, draggedTabId)) {
                index += 1;
            }

            if (targetNode.parentId) {
                this.setParent(draggedTabId, targetNode.parentId);
            } else {
                this.parent_map.set(draggedTabId, -1);
            }
            await browser.tabs.move(draggedTabId, { index });
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
}

document.addEventListener('DOMContentLoaded', () => {
    new TabTreeSidebar('tree-container');
});
