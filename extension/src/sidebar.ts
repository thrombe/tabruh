// This code now works in BOTH Chrome and Firefox
import browser from "webextension-polyfill";

browser.browserAction.onClicked.addListener(async (tab) => {
    // In Firefox, this calls browser.sidebarAction.open()
    // In Chrome, the polyfill translates this to chrome.sidePanel.open()
    await browser.sidebarAction.open();
});
