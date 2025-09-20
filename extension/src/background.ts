import browser from "webextension-polyfill";

async function main() {
    console.log("lmao man");
    let results = await browser.storage.local.get();

    // Initialize the saved stats if not yet initialized.
    if (!results.stats) {
        results = {
            host: {},
            type: {}
        };
    }

    // Monitor completed navigation events and update
    // stats accordingly.
    browser.webNavigation.onCommitted.addListener((evt) => {
        if (evt.frameId !== 0) {
            return;
        }

        console.log("new tab?")

        let transitionType = evt.transitionType;
        results.type[transitionType] = results.type[transitionType] || 0;
        results.type[transitionType]++;

        // Persist the updated stats.
        browser.storage.local.set(results);
    });

    browser.webNavigation.onCompleted.addListener(evt => {
        // Filter out any sub-frame related navigation event
        if (evt.frameId !== 0) {
            return;
        }

        const url = new URL(evt.url);

        results.host[url.hostname] = results.host[url.hostname] || 0;
        results.host[url.hostname]++;

        // Persist the updated stats.
        browser.storage.local.set(results);
    }, {
        url: [{ schemes: ["http", "https"] }]
    });
}

main()
