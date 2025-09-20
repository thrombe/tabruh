import browser from "webextension-polyfill";

async function main() {
    console.log("tabruh loaded");

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
        let tab = await browser.tabs.get(id);
        console.log("tab updated ", id, tab.status);
        console.log(tab);
        if (tab.status == "complete" && !tab.discarded && !tab.active) {
            console.log("switch to " + tab.id);
            console.log(await browser.tabs.update(tab.id, { active: true }));

            if (tab.openerTabId) {
                console.log("discard " + tab.openerTabId);
                await browser.tabs.discard(tab.openerTabId);
            }
        }
    });

    // Monitor completed navigation events and update
    // stats accordingly.
    browser.webNavigation.onCommitted.addListener(async (evt) => {
        if (evt.frameId !== 0) {
            return;
        }
        // console.log(await browser.tabs.query({ currentWindow: true }));

        // console.log("new tab?")

        let transitionType = evt.transitionType;
    });

    browser.webNavigation.onCompleted.addListener(evt => {
        // Filter out any sub-frame related navigation event
        if (evt.frameId !== 0) {
            return;
        }

        const url = new URL(evt.url);
        console.log(url);
    }, {
        url: [{ schemes: ["http", "https"] }]
    });
}

main()
