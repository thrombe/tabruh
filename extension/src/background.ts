import browser from "webextension-polyfill";

type TabNode = {
    id: number;
    url: string;
    title?: string;
    children: number[];
    parentId?: number;
};

type WindowTabTree = {
    [tabId: number]: TabNode;
};

class TabTracker {
    private tabTrees: { [windowId: number]: WindowTabTree } = {};

    constructor() {
        this.initListeners();
    }

    private initListeners(): void {
        browser.tabs.onCreated.addListener(this.handleTabCreated.bind(this));
        browser.tabs.onUpdated.addListener(this.handleTabUpdated.bind(this));
        browser.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
        browser.windows.onRemoved.addListener(this.handleWindowRemoved.bind(this));
        browser.runtime.onMessage.addListener(this.handleMessage.bind(this));
    }

    private getWindowTree(windowId: number): WindowTabTree {
        if (!this.tabTrees[windowId]) {
            this.tabTrees[windowId] = {};
        }
        return this.tabTrees[windowId];
    }

    private handleTabCreated(tab: browser.Tabs.Tab): void {
        if (tab.id === undefined || tab.windowId === undefined) return;

        const windowTree = this.getWindowTree(tab.windowId);

        const newNode: TabNode = {
            id: tab.id,
            url: tab.url ?? "",
            title: tab.title,
            children: [],
            parentId: tab.openerTabId,
        };

        windowTree[tab.id] = newNode;

        if (tab.openerTabId !== undefined && windowTree[tab.openerTabId]) {
            windowTree[tab.openerTabId]!.children.push(tab.id);
        }

        console.log(`[Tab Created] Tab ${tab.id} in Window ${tab.windowId}`);

        console.log(this.tabTrees);
    }

    private handleTabUpdated(
        tabId: number,
        changeInfo: browser.Tabs.OnUpdatedChangeInfoType,
        tab: browser.Tabs.Tab
    ): void {
        const windowTree = this.tabTrees[tab.windowId!];
        if (!windowTree) return;

        const node = windowTree[tabId];
        if (!node) return;

        if (changeInfo.url) node.url = changeInfo.url;
        if (changeInfo.title) node.title = changeInfo.title;
    }

    private handleTabRemoved(tabId: number, removeInfo: browser.Tabs.OnRemovedRemoveInfoType): void {
        const windowTree = this.tabTrees[removeInfo.windowId];
        if (!windowTree) return;

        const removedTab = windowTree[tabId];
        if (!removedTab) return;

        if (removedTab.parentId !== undefined && windowTree[removedTab.parentId]) {
            const siblings = windowTree[removedTab.parentId]!.children;
            windowTree[removedTab.parentId]!.children = siblings.filter(id => id !== tabId);
        }

        delete windowTree[tabId];

        console.log(`[Tab Removed] Tab ${tabId} from Window ${removeInfo.windowId}`);
    }

    private handleWindowRemoved(windowId: number): void {
        delete this.tabTrees[windowId];
        console.log(`[Window Removed] Window ${windowId}`);
    }

    private async handleMessage(
        message: unknown,
        _sender: browser.Runtime.MessageSender
    ): Promise<any> {
        if (message === "printTree") {
            console.log("Current tabTrees:", JSON.parse(JSON.stringify(this.tabTrees)));
            return { status: "ok", tabTrees: this.tabTrees };
        }

        return { status: "unknown_command" };
    }
}

async function main() {
    console.log("tabruh loaded");

    let tabruh = new TabTracker();

    browser.tabs.onActivated.addListener(async tab => {
        // console.log("tab activated");
        // console.log(tab);
        // console.log(await browser.windows.get(tab.windowId));
        // console.log(await browser.tabs.get(tab.previousTabId ?? 0));
        // console.log(await browser.tabs.get(tab.tabId));

        // console.log(await browser.tabs.update(tab.tabId, { active: true }));
        // console.log(await browser.tabs.discard(tab.previousTabId ?? 0));
    });
    browser.tabs.onCreated.addListener(async tab => {
        // console.log("tab created");
        // console.log(tab);
        // console.log(await browser.tabs.get(tab.openerTabId ?? 0));
    });
    browser.tabs.onUpdated.addListener(async id => {
        // let tab = await browser.tabs.get(id);
        // console.log("tab updated ", id, tab.status);
        // console.log(tab);
        // if (tab.status == "complete" && !tab.discarded && !tab.active) {
        //     console.log("switch to " + tab.id);
        //     console.log(await browser.tabs.update(tab.id, { active: true }));

        //     if (tab.openerTabId) {
        //         console.log("discard " + tab.openerTabId);
        //         await browser.tabs.discard(tab.openerTabId);
        //     }
        // }
    });

    // Monitor completed navigation events and update
    // stats accordingly.
    browser.webNavigation.onCommitted.addListener(async (evt) => {
        // if (evt.frameId !== 0) {
        //     return;
        // }
        // console.log(await browser.tabs.query({ currentWindow: true }));

        // console.log("new tab?")

        // let transitionType = evt.transitionType;
    });

    browser.webNavigation.onCompleted.addListener(evt => {
        // Filter out any sub-frame related navigation event
        // if (evt.frameId !== 0) {
        //     return;
        // }

        // const url = new URL(evt.url);
        // console.log(url);
    }, {
        url: [{ schemes: ["http", "https"] }]
    });
}

main()
