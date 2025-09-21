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

function buildTabTree(tabs: browser.Tabs.Tab[]): { nodes: TabTree, rootIds: number[] } {
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
            parentId: tab.openerTabId,
            children: [],
        });
    }

    for (const node of nodes.values()) {
        const tab = tabsById.get(node.id)!;
        let parentId = tab.openerTabId;

        if (parentId !== undefined && nodes.has(parentId)) {
            const parent = nodes.get(parentId)!;
            parent.children.push(node.id);
        } else {
            rootIds.push(node.id);
        }
    }

    return { nodes, rootIds };
}

function renderNode(nodeId: number, nodes: TabTree): HTMLDivElement {
    const node = nodes.get(nodeId)!;

    const nodeWrapper = document.createElement('div');
    nodeWrapper.dataset.tabId = String(node.id);
    nodeWrapper.draggable = true;

    const nodeElement = document.createElement('div');
    nodeElement.className = 'tree-node';

    nodeElement.addEventListener('click', async () => {
        try {
            const tab = await browser.tabs.get(node.id);
            if (tab.windowId) {
                await browser.windows.update(tab.windowId, { focused: true });
            }
            await browser.tabs.update(node.id, { active: true });
        } catch (e) {
            console.error(`Could not focus tab ${node.id}:`, e);
        }
    });

    nodeWrapper.addEventListener('dragstart', (event) => {
        event.dataTransfer!.setData('text/plain', String(node.id));
        event.dataTransfer!.effectAllowed = 'move';
        setTimeout(() => {
            nodeWrapper.classList.add('dragging');
        }, 0);
    });

    nodeWrapper.addEventListener('dragend', () => {
        nodeWrapper.classList.remove('dragging');
    });

    nodeElement.addEventListener('dragover', (event) => {
        event.preventDefault();
        const draggedId = event.dataTransfer?.getData('text/plain');
        if (draggedId && draggedId !== String(node.id)) {
            event.dataTransfer!.dropEffect = 'move';
            nodeElement.classList.add('drag-over-target');
        }
    });

    nodeElement.addEventListener('dragleave', () => {
        nodeElement.classList.remove('drag-over-target');
    });

    nodeElement.addEventListener('drop', async (event) => {
        event.preventDefault();
        nodeElement.classList.remove('drag-over-target');

        const draggedTabIdStr = event.dataTransfer?.getData('text/plain');
        if (!draggedTabIdStr) return;

        const draggedTabId = parseInt(draggedTabIdStr, 10);
        const targetTabId = node.id;

        if (draggedTabId !== targetTabId) {
            try {
                const targetTab = await browser.tabs.get(targetTabId);
                await browser.tabs.move(draggedTabId, { index: targetTab.index });
            } catch (e) {
                console.error('Failed to move tab:', e);
            }
        }
    });

    const icon = document.createElement('img');
    icon.src = node.favIconUrl || DEFAULT_FAVICON_URL;
    icon.alt = 'favicon';
    icon.className = 'tree-node-icon';

    const title = document.createElement('span');
    title.className = 'tree-node-title';
    title.textContent = node.title;

    nodeElement.appendChild(icon);
    nodeElement.appendChild(title);
    nodeWrapper.appendChild(nodeElement);

    if (node.children.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'children-container';
        for (const childId of node.children) {
            const childElement = renderNode(childId, nodes);
            childrenContainer.appendChild(childElement);
        }
        nodeWrapper.appendChild(childrenContainer);
    }

    return nodeWrapper;
}

function renderTree(nodes: TabTree, rootIds: number[], container: HTMLElement) {
    container.innerHTML = '';

    if (rootIds.length === 0) {
        container.textContent = 'No tabs found.';
        return;
    }

    const rootContainer = document.createElement('div');
    rootContainer.className = 'flex flex-col';

    for (const rootId of rootIds) {
        const nodeElement = renderNode(rootId, nodes);
        rootContainer.appendChild(nodeElement);
    }

    container.appendChild(rootContainer);
}

async function main() {
    const container = document.getElementById('tree-container');
    if (!container) {
        console.error('Sidebar container #tree-container not found.');
        return;
    }

    const tabs = await browser.tabs.query({ currentWindow: true });
    const { nodes, rootIds } = buildTabTree(tabs);
    renderTree(nodes, rootIds, container);
}

document.addEventListener('DOMContentLoaded', main);

const updateSidebar = () => {
    main();
};

browser.tabs.onCreated.addListener(updateSidebar);
browser.tabs.onRemoved.addListener(updateSidebar);
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status || changeInfo.title || changeInfo.favIconUrl) {
        updateSidebar();
    }
});
browser.tabs.onMoved.addListener(updateSidebar);
browser.tabs.onAttached.addListener(updateSidebar);
browser.tabs.onDetached.addListener(updateSidebar);
