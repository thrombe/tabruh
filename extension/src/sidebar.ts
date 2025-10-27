import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import type { AppRequest, AppResponse, ExtensionAction, StateAction, WindowId } from './types';

class TabTreeSidebar {
    private port: browser.Runtime.Port;
    private view: TabTreeView | null = null;
    private windowId: WindowId | undefined;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Sidebar container #${containerId} not found.`);

        this.port = browser.runtime.connect({ name: 'sidebar-connection' });
        this.init(el);
    }

    private async init(container: HTMLElement) {
        const win = await browser.windows.getCurrent();
        this.windowId = win.id as WindowId;

        if (!this.windowId) {
            console.error("Could not determine window ID for the sidebar.");
            return;
        }

        this.view = new TabTreeView(container, this.port, "sidebar", 'window');

        this.port.onMessage.addListener(message => this.handleMessage(message as AppResponse));
        this.port.onDisconnect.addListener(() => console.error("Sidebar disconnected from background script."));

        this.requestState();
    }

    private requestState() {
        if (this.windowId) {
            this.sendRequest({ type: 'get_state_for_window', payload: { wid: this.windowId } });
        }
    }

    private sendRequest(msg: AppRequest) {
        this.sendMessage({ type: 'app_request', payload: msg })
    }

    private sendAction(msg: StateAction) {
        this.sendMessage({ type: 'state_action', payload: msg })
    }

    private sendMessage(message: ExtensionAction) {
        try {
            this.port.postMessage(message);
        } catch (e) {
            console.error("Could not send message to background script.", e);
        }
    }

    private handleMessage(message: AppResponse) {
        if (message.type === 'render_all') {
            this.requestState();
        } else if (message.type === 'state_update' && this.view) {
            // In sidebar, we only care about updates for our own window/group.
            // The background script already filters this, so we just render.
            this.view.render(message.payload.state);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new TabTreeSidebar('tree-container');
});
