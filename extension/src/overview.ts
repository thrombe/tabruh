import './overview.css';
import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import type { BruhId, BackgroundPortRequest, BackgroundResponse, UiStateForRender, BruhExport, SideberryExport } from './types';

class OverviewPage {
    private port: browser.Runtime.Port | null = null;
    private container: HTMLElement;
    private views: Map<number, TabTreeView> = new Map();
    private viewMode: 'overview' | 'group' = 'overview';
    private groupViewNodeId?: BruhId;
    private hasConnected = false;
    private action?: string;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Overview container #${containerId} not found.`);
        this.container = el;

        const urlParams = new URLSearchParams(window.location.search);
        const view = urlParams.get('view');
        const nodeId = urlParams.get('id');
        const group_name = urlParams.get('name');
        const action = urlParams.get('action');

        if (action) {
            this.action = action;
            document.title = `Tabruh - ${action.charAt(0).toUpperCase() + action.slice(1)}`;
        } else if (view === 'group' && nodeId) {
            this.viewMode = 'group';
            this.groupViewNodeId = parseInt(nodeId, 10) as BruhId;
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

        if (this.action === 'import') {
            this.handleImport();
        } else {
            this.requestInitialState();
        }
    }

    private sendMessage(message: BackgroundPortRequest) {
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
            this.sendMessage({ type: 'get_state_for_group_view', payload: { bid: this.groupViewNodeId } });
        } else {
            this.sendMessage({ type: 'get_all_window_states', payload: {} });
        }
    }

    private sortWindowStates(states: UiStateForRender[]): UiStateForRender[] {
        return states.sort((a, b) => {
            if (a.is_closed !== b.is_closed) {
                return a.is_closed ? 1 : -1;
            }
            if (a.is_custom_named !== b.is_custom_named) {
                return a.is_custom_named ? -1 : 1;
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

    private handleImport() {
        this.container.innerHTML = `
            <div class="action-page-container">
                <h1 class="action-page-title">Import State</h1>
                <p class="action-page-description">Select a Tabruh or Sideberry export file (.json) to import.</p>
                <button id="select-file-button" class="action-page-button">Select File</button>
            </div>
        `;

        const button = document.getElementById('select-file-button');
        if (!button) return;

        button.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.style.display = 'none';

            input.addEventListener('change', () => {
                const file = input.files?.[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        try {
                            const content = e.target?.result as string;
                            const data = JSON.parse(content);

                            if (data.id) { // Sideberry format
                                this.sendMessage({ type: 'convert_sideberry_export', payload: { data: data as SideberryExport } });
                            } else if (data.timestamp) { // Bruh format
                                this.sendMessage({ type: 'load_bruh_export', payload: { data: data as BruhExport } });
                                alert('Import successful! Your imported windows have been added as closed windows.');
                                window.close();
                            } else {
                                alert('Unrecognized export format.');
                                window.close();
                            }
                        } catch (err) {
                            console.error('Error importing file:', err);
                            alert('Failed to read or parse the import file.');
                            window.close();
                        }
                    };
                    reader.readAsText(file);
                } else {
                    window.close();
                }
            });

            const onFocus = () => {
                window.removeEventListener('focus', onFocus);
                setTimeout(() => {
                    if (!input.files || input.files.length === 0) {
                        window.close();
                    }
                }, 500);
            };
            window.addEventListener('focus', onFocus, { once: true });

            document.body.appendChild(input);
            input.click();
            document.body.removeChild(input);
        });
    }

    private handleMessage(message: BackgroundResponse) {
        switch (message.type) {
            case 'all_states_update': {
                if (this.viewMode === 'overview') {
                    this.renderOverviewLayout(message.payload.states);
                }
                break;
            }
            case 'state_update': {
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
            case 'render_all': {
                if (!this.action) {
                    this.requestInitialState();
                }
                break;
            }
            case 'converted_sideberry_export_ready': {
                this.sendMessage({ type: 'load_bruh_export', payload: { data: message.payload.data } });
                alert('Sideberry data imported successfully! Your imported windows have been added as closed windows.');
                window.close();
            } break;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new OverviewPage('overview-container');
});
