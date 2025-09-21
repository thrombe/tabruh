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

// A Map is more efficient for lookups than an object.
type TabTree = Map<number, TabNode>;

const DEFAULT_FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
const DEFAULT_FAVICON_URL = `data:image/svg+xml;base64,${btoa(DEFAULT_FAVICON)}`;


/**
 * Takes a flat array of tabs and organizes them into a tree structure.
 * @param tabs - The array of Tab objects from browser.tabs.query.
 * @returns An object containing the tree as a Map and an array of root node IDs.
 */
function buildTabTree(tabs: browser.Tabs.Tab[]): { nodes: TabTree, rootIds: number[] } {
    const nodes: TabTree = new Map();
    const rootIds: number[] = [];

    // First pass: Create a node for every tab and add it to the map.
    for (const tab of tabs) {
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

    // Second pass: Link children to their parents.
    for (const node of nodes.values()) {
        if (node.parentId !== undefined && nodes.has(node.parentId)) {
            // This is a child of another tab in the current window.
            const parent = nodes.get(node.parentId)!;
            parent.children.push(node.id);
        } else {
            // This is a root node (no parent or parent is not in this window).
            rootIds.push(node.id);
        }
    }

    return { nodes, rootIds };
}

/**
 * Recursively renders a single node and its children.
 * @param nodeId - The ID of the node to render.
 * @param nodes - The full map of all nodes in the tree.
 * @returns An HTMLLIElement representing the node and its descendants.
 */
function renderNode(nodeId: number, nodes: TabTree): HTMLLIElement {
    const node = nodes.get(nodeId)!;

    const li = document.createElement('li');
    li.dataset.tabId = String(node.id);

    const nodeDiv = document.createElement('div');
    nodeDiv.className = 'tree-node';

    const icon = document.createElement('img');
    icon.src = node.favIconUrl || DEFAULT_FAVICON_URL;
    icon.alt = 'favicon';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = node.title;

    nodeDiv.appendChild(icon);
    nodeDiv.appendChild(title);
    li.appendChild(nodeDiv);

    // If the node has children, create a nested list and recurse.
    if (node.children.length > 0) {
        const ul = document.createElement('ul');
        for (const childId of node.children) {
            const childLi = renderNode(childId, nodes);
            ul.appendChild(childLi);
        }
        li.appendChild(ul);
    }

    return li;
}

/**
 * Renders the entire tab tree into the DOM.
 * @param nodes - The full map of all nodes in the tree.
 * @param rootIds - An array of IDs for the top-level nodes.
 * @param container - The DOM element to render the tree into.
 */
function renderTree(nodes: TabTree, rootIds: number[], container: HTMLElement) {
    // Clear any existing content
    container.innerHTML = '';

    if (rootIds.length === 0) {
        container.textContent = 'No tabs found.';
        return;
    }

    const rootUl = document.createElement('ul');
    for (const rootId of rootIds) {
        const nodeLi = renderNode(rootId, nodes);
        rootUl.appendChild(nodeLi);
    }

    container.appendChild(rootUl);
}

/**
 * Main function to initialize the sidebar.
 */
async function main() {
    const container = document.getElementById('tree-container');
    if (!container) {
        console.error('Sidebar container #tree-container not found.');
        return;
    }

    // Get all tabs in the current window.
    const tabs = await browser.tabs.query({ currentWindow: true });

    // Build the tree structure from the tabs.
    const { nodes, rootIds } = buildTabTree(tabs);

    // Render the final tree.
    renderTree(nodes, rootIds, container);
}

// Run the main function once the DOM is ready.
document.addEventListener('DOMContentLoaded', main);
