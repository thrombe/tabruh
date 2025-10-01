import './overview.css';
import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import type { BackgroundRequest, BackgroundResponse, UiStateForRender } from './types';

class OverviewPage {
    private port: browser.Runtime.Port | null = null;
    private container: HTMLElement;
    private views: Map<number, TabTreeView> = new Map();
    private viewMode: 'overview' | 'group' = 'overview';
    private groupViewNodeId?: number;
    private hasConnected = false;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Overview container #${containerId} not found.`);
        this.container = el;

        const urlParams = new URLSearchParams(window.location.search);
        const view = urlParams.get('view');
        const nodeId = urlParams.get('id');
        const group_name = urlParams.get('name');

        if (view === 'group' && nodeId) {
            this.viewMode = 'group';
            this.groupViewNodeId = parseInt(nodeId, 10);
            this.container.classList.add('group-view-mode');
            document.title = group_name ?? "Tabruh Group";
        } else {
            this.viewMode = 'overview';
            document.title = "Tabruh Overview";
        }

        this.setupConnectionListener();
    }

    private setupConnectionListener() {
        if (document.visibilityState === 'visible') {
            this.connectAndInit();
        } else {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    this.connectAndInit();
                }
            }, { once: true });
        }
        window.addEventListener('focus', () => this.connectAndInit(), { once: true });
    }

    private connectAndInit() {
        if (this.hasConnected) {
            return;
        }
        this.hasConnected = true;

        this.port = browser.runtime.connect({ name: 'overview-connection' });
        this.port.onMessage.addListener(message => this.handleMessage(message as BackgroundResponse));
        this.port.onDisconnect.addListener(() => console.error("Overview page disconnected from background script."));

        this.requestInitialState();
    }

    private sendMessage(message: BackgroundRequest) {
        if (!this.port) {
            console.warn("Attempted to send message before port was connected.", message);
            return;
        }
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
            if (a.isClosed !== b.isClosed) {
                return a.isClosed ? 1 : -1;
            }
            if (a.isCustomNamed !== b.isCustomNamed) {
                return a.isCustomNamed ? -1 : 1;
            }
            return a.generation - b.generation;
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
            windowViewWrapper.dataset.stateId = state.id.toString();
            this.container.appendChild(windowViewWrapper);
            if (!this.port) return;
            const viewType = this.viewMode === 'group' ? 'group' : 'window';
            view = new TabTreeView(windowViewWrapper, this.port, false, viewType);
            this.views.set(state.id, view);
        }
        view.render(state);
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
                } else {
                    // This can happen if a RENAME action triggers a RENDER_ALL, but the background only sends a STATE_UPDATE for the affected window.
                    // To ensure correct sorting, we should just refresh everything.
                    this.requestInitialState();
                }
                break;
            }
            case 'RENDER_ALL': {
                this.requestInitialState();
                break;
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new OverviewPage('overview-container');
});
