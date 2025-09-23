import './overview.css';
import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import type { BackgroundRequest, BackgroundResponse, UiStateForRender } from './types';

class OverviewPage {
    private port: browser.Runtime.Port;
    private container: HTMLElement;
    private views: Map<string, TabTreeView> = new Map();

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

        this.requestAllGroups();
    }

    private sendMessage(message: BackgroundRequest) {
        try {
            this.port.postMessage(message);
        } catch (e) {
            console.error("Could not send message to background script.", e);
        }
    }

    private requestAllGroups() {
        this.sendMessage({ type: 'GET_ALL_GROUPS', payload: {} });
    }

    private sortGroups(groups: UiStateForRender[]): UiStateForRender[] {
        return groups.sort((a, b) => {
            const aIsNamed = !/^Window \d+$/.test(a.name);
            const bIsNamed = !/^Window \d+$/.test(b.name);

            // 1. Open groups before closed groups
            if (a.isClosed !== b.isClosed) {
                return a.isClosed ? 1 : -1;
            }

            // 2. Named groups before unnamed groups
            if (aIsNamed !== bIsNamed) {
                return aIsNamed ? -1 : 1;
            }

            // 3. Sort by creation time (older first)
            return a.creationTimestamp - b.creationTimestamp;
        });
    }

    private renderLayout(groups: UiStateForRender[]) {
        this.container.innerHTML = '';
        this.views.clear();
        const sortedGroups = this.sortGroups(groups);

        for (const group of sortedGroups) {
            this.addOrUpdateGroupView(group);
        }
    }

    private addOrUpdateGroupView(groupState: UiStateForRender) {
        let view = this.views.get(groupState.id);
        if (!view) {
            const windowViewWrapper = document.createElement('div');
            windowViewWrapper.className = 'window-view';
            windowViewWrapper.dataset.groupId = groupState.id;
            this.container.appendChild(windowViewWrapper);
            view = new TabTreeView(windowViewWrapper, this.port);
            this.views.set(groupState.id, view);
        }
        view.render(groupState);
    }

    private removeGroupView(groupId: string) {
        if (this.views.has(groupId)) {
            const wrapper = this.container.querySelector(`[data-group-id='${groupId}']`);
            wrapper?.remove();
            this.views.delete(groupId);
        }
    }

    private handleMessage(message: BackgroundResponse) {
        switch (message.type) {
            case 'ALL_GROUPS_UPDATE': {
                this.renderLayout(message.payload.groups);
                break;
            }
            case 'RENDER_ALL': {
                this.requestAllGroups();
                break;
            }
            case 'GROUP_REMOVED': {
                this.removeGroupView(message.payload.groupId);
                break;
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new OverviewPage('overview-container');
});
