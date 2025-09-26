import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import type { BackgroundRequest, BackgroundResponse } from './types';

class TabTreeSidebar {
    private port: browser.Runtime.Port;
    private view: TabTreeView | null = null;
    private windowId: number | undefined;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Sidebar container #${containerId} not found.`);

        this.port = browser.runtime.connect({ name: 'sidebar-connection' });
        this.init(el);
    }

    private async init(container: HTMLElement) {
        const win = await browser.windows.getCurrent();
        this.windowId = win.id;

        if (!this.windowId) {
            console.error("Could not determine window ID for the sidebar.");
            return;
        }

        this.view = new TabTreeView(container, this.port, true, 'window');

        this.port.onMessage.addListener((message: BackgroundResponse) => this.handleMessage(message));
        this.port.onDisconnect.addListener(() => console.error("Sidebar disconnected from background script."));

        this.requestState();
    }

    private requestState() {
        if (this.windowId) {
            this.sendMessage({ type: 'GET_STATE_FOR_WINDOW', payload: { windowId: this.windowId } });
        }
    }

    private sendMessage(message: BackgroundRequest) {
        try {
            this.port.postMessage(message);
        } catch (e) {
            console.error("Could not send message to background script.", e);
        }
    }

    private handleMessage(message: BackgroundResponse) {
        if (message.type === 'RENDER_ALL') {
            this.requestState();
        } else if (message.type === 'STATE_UPDATE' && this.view) {
            // In sidebar, we only care about updates for our own window/group.
            // The background script already filters this, so we just render.
            this.view.render(message.payload.state);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new TabTreeSidebar('tree-container');
});
