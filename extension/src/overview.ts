import './overview.css';
import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import type { BackgroundRequest, BackgroundResponse } from './types';

class OverviewPage {
    private port: browser.Runtime.Port;
    private container: HTMLElement;
    private views: Map<number, TabTreeView> = new Map();

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Overview container #${containerId} not found.`);
        this.container = el;

        this.port = browser.runtime.connect({ name: 'overview-connection' });
        this.init();
    }

    private async init() {
        this.port.onMessage.addListener((message: BackgroundResponse) => this.handleMessage(message));
        this.port.onDisconnect.addListener(() => console.error("Overview page disconnected from background script."));

        await this.renderInitialLayout();
    }

    private sendMessage(message: BackgroundRequest) {
        try {
            this.port.postMessage(message);
        } catch (e) {
            console.error("Could not send message to background script.", e);
        }
    }

    private async renderInitialLayout() {
        this.container.innerHTML = '';
        this.views.clear();

        const windows = await browser.windows.getAll({ windowTypes: ['normal'] });
        windows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

        for (const win of windows) {
            if (win.id) {
                this.addWindowView(win.id);
            }
        }
    }

    private addWindowView(windowId: number) {
        if (this.views.has(windowId)) return;

        const windowViewWrapper = document.createElement('div');
        windowViewWrapper.className = 'window-view';
        windowViewWrapper.dataset.windowId = String(windowId);

        const header = document.createElement('h2');
        header.className = 'window-view-header';
        header.textContent = `Window ${windowId}`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'window-view-content';

        windowViewWrapper.append(header, contentDiv);
        this.container.appendChild(windowViewWrapper);

        const view = new TabTreeView(contentDiv, this.port, windowId);
        this.views.set(windowId, view);

        this.sendMessage({ type: 'GET_STATE', payload: { windowId } });
    }

    private removeWindowView(windowId: number) {
        if (this.views.has(windowId)) {
            const wrapper = this.container.querySelector(`[data-window-id='${windowId}']`);
            wrapper?.remove();
            this.views.delete(windowId);
        }
    }

    private handleMessage(message: BackgroundResponse) {
        switch (message.type) {
            case 'STATE_UPDATE': {
                const view = this.views.get(message.payload.windowId);
                if (view) {
                    view.render(message.payload.state);
                }
                break;
            }
            case 'RENDER': {
                if (this.views.has(message.payload.windowId)) {
                    this.sendMessage({ type: 'GET_STATE', payload: { windowId: message.payload.windowId } });
                }
                break;
            }
            case 'WINDOW_CREATED': {
                this.addWindowView(message.payload.windowId);
                break;
            }
            case 'WINDOW_REMOVED': {
                this.removeWindowView(message.payload.windowId);
                break;
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new OverviewPage('overview-container');
});
