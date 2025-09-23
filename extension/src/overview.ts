import './overview.css';
import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import type { BackgroundRequest, BackgroundResponse } from './types';

class OverviewPage {
    private port: browser.Runtime.Port;
    private container: HTMLElement;
    private views: Map<number, TabTreeView> = new Map();
    private renderTimeout: number | null = null;

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
            if (!win.id) continue;

            const windowViewWrapper = document.createElement('div');
            windowViewWrapper.className = 'window-view';
            windowViewWrapper.dataset.windowId = String(win.id);

            const header = document.createElement('h2');
            header.className = 'window-view-header';
            header.textContent = `Window ${win.id}`;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'window-view-content';

            windowViewWrapper.append(header, contentDiv);
            this.container.appendChild(windowViewWrapper);

            const view = new TabTreeView(contentDiv, this.port, win.id);
            this.views.set(win.id, view);

            this.sendMessage({ type: 'GET_STATE', payload: { windowId: win.id } });
        }
    }

    private handleMessage(message: BackgroundResponse) {
        if (message.type === 'STATE_UPDATE') {
            const view = this.views.get(message.payload.windowId);
            if (view) {
                view.render(message.payload.state);
            }
        } else if (message.type === 'RENDER') {
            // Debounce the full layout re-render
            if (this.renderTimeout) {
                clearTimeout(this.renderTimeout);
            }
            // @ts-ignore
            this.renderTimeout = setTimeout(() => this.renderInitialLayout(), 100);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new OverviewPage('overview-container');
});
