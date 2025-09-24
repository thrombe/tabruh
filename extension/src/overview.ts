import './overview.css';
import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import type { BackgroundRequest, BackgroundResponse, UiStateForRender } from './types';

class OverviewPage {
    private port: browser.Runtime.Port;
    private container: HTMLElement;
    private views: Map<string, TabTreeView> = new Map();
    private viewMode: 'overview' | 'group' = 'overview';
    private groupViewNodeId?: number;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Overview container #${containerId} not found.`);
        this.container = el;

        const urlParams = new URLSearchParams(window.location.search);
        const view = urlParams.get('view');
        const nodeId = urlParams.get('id');

        if (view === 'group' && nodeId) {
            this.viewMode = 'group';
            this.groupViewNodeId = parseInt(nodeId, 10);
            this.container.classList.add('group-view-mode');
        }

        this.port = browser.runtime.connect({ name: 'overview-connection' });
        this.init();
    }

    private async init() {
        this.port.onMessage.addListener((message: BackgroundResponse) => this.handleMessage(message));
        this.port.onDisconnect.addListener(() => console.error("Overview page disconnected from background script."));

        this.requestInitialState();
    }

    private sendMessage(message: BackgroundRequest) {
        try {
            this.port.postMessage(message);
        } catch (e) {
            console.error("Could not send message to background script.", e);
        }
    }

    private requestInitialState() {
        if (this.viewMode === 'group' && this.groupViewNodeId) {
            this.sendMessage({ type: 'GET_STATE_FOR_GROUP_VIEW', payload: { nodeId: this.groupViewNodeId } });
        } else {
            this.sendMessage({ type: 'GET_ALL_WINDOW_STATES', payload: {} });
        }
    }

    private sortWindowStates(states: UiStateForRender[]): UiStateForRender[] {
        return states.sort((a, b) => {
            const aIsNamed = !/^Window \d+$/.test(a.name);
            const bIsNamed = !/^Window \d+$/.test(b.name);

            if (a.isClosed !== b.isClosed) {
                return a.isClosed ? 1 : -1;
            }
            if (aIsNamed !== bIsNamed) {
                return aIsNamed ? -1 : 1;
            }
            return a.creationTimestamp - b.creationTimestamp;
        });
    }

    private renderOverviewLayout(states: UiStateForRender[]) {
        this.container.innerHTML = '';
        this.views.clear();
        const sortedStates = this.sortWindowStates(states);

        for (const state of sortedStates) {
            this.addOrUpdateStateView(state);
        }
    }

    private renderGroupLayout(state: UiStateForRender) {
        this.container.innerHTML = '';
        this.views.clear();
        this.addOrUpdateStateView(state);
    }

    private addOrUpdateStateView(state: UiStateForRender) {
        let view = this.views.get(state.id);
        if (!view) {
            const windowViewWrapper = document.createElement('div');
            windowViewWrapper.className = 'window-view';
            windowViewWrapper.dataset.stateId = state.id;
            this.container.appendChild(windowViewWrapper);
            view = new TabTreeView(windowViewWrapper, this.port);
            this.views.set(state.id, view);
        }
        view.render(state);
    }

    private removeStateView(stateId: string) {
        if (this.views.has(stateId)) {
            const wrapper = this.container.querySelector(`[data-state-id='${stateId}']`);
            wrapper?.remove();
            this.views.delete(stateId);
        }
    }

    private handleMessage(message: BackgroundResponse) {
        switch (message.type) {
            case 'ALL_STATES_UPDATE': {
                if (this.viewMode === 'overview') {
                    this.renderOverviewLayout(message.payload.states);
                }
                break;
            }
            case 'STATE_UPDATE': {
                if (this.viewMode === 'group') {
                    document.title = message.payload.state.name;
                    this.renderGroupLayout(message.payload.state);
                }
                break;
            }
            case 'RENDER_ALL': {
                this.requestInitialState();
                break;
            }
            case 'STATE_REMOVED': {
                if (this.viewMode === 'overview') {
                    this.removeStateView(message.payload.stateId);
                }
                break;
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new OverviewPage('overview-container');
});
