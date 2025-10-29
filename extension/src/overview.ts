import './overview.css';
import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import * as utils from './utils';
import type {
    BruhId,
    AppRequest,
    AppResponse,
    BruhExport,
    SideberryExport,
    ExtensionAction,
    StateAction,
    StateEvent,
    StateEffect,
    AppEffect,
    BruhUiEvent,
    WindowData,
} from './types';
import { State } from './state';

class OverviewPage {
    state: State;
    ui_events: utils.Channel<BruhUiEvent>;
    state_effects: utils.Deque<StateEffect>;
    app_effects: utils.Deque<AppEffect>

    private port: browser.Runtime.Port | null = null;
    private container: HTMLElement;
    private views: Map<BruhId, TabTreeView> = new Map();
    private viewMode: 'overview' | 'group' = 'overview';
    private groupViewNodeId?: BruhId;
    private hasConnected = false;
    private action?: string;

    constructor(containerId: string) {
        this.state = new State("0.0");
        this.ui_events = new utils.Channel();
        this.state_effects = new utils.Deque();
        this.app_effects = new utils.Deque();

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

    handle_event(event: StateEvent) {
        this.state.handle_event(event, this.state_effects, this.app_effects);
        while (true) {
            const effect = this.state_effects.pop_front();
            if (!effect) break;
            this.state.handle_effect(effect, this.state_effects, this.app_effects);
        }
        this.app_effects.clear();
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
        this.port.onMessage.addListener(async message => await this.ui_events.send(message as BruhUiEvent));
        this.port.onDisconnect.addListener(() => console.error("Overview page disconnected from background script."));

        if (this.action === 'import') {
            this.handleImport();
        } else {
            this.requestInitialState();
        }
    }

    private sendRequest(msg: AppRequest) {
        this.sendMessage({ type: 'app_request', payload: msg })
    }

    private sendAction(msg: StateAction) {
        this.sendMessage({ type: 'state_action', payload: msg })
    }

    private sendMessage(message: ExtensionAction) {
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

    async handle_events() {
        while (true) {
            const event = await this.ui_events.wait_recv();
            if (!event) break;
            this.handleMessage(event);
            this.render();
        }
    }

    private handleMessage(message: BruhUiEvent) {
        switch (message.type) {
            case 'state_effect': {
                this.handle_event({ type: 'state_effect', payload: message.payload });
            } break;
            case 'state_action': {
                this.handle_event({ type: 'state_action', payload: message.payload });
            } break;
            case 'app_response': {
                switch (message.payload.type) {
                    case 'initial_state': {
                        this.state = State.from_clonable_state(message.payload.payload);
                    } break;
                    case 'converted_sideberry_export_ready': {
                        this.sendAction({ type: 'load_bruh_export', payload: { data: message.payload.data } });
                        alert('Sideberry data imported successfully! Your imported windows have been added as closed windows.');
                        window.close();
                    } break;
                    case 'snapshots_list_update':
                        // overview page does not care about this
                        break;
                }
            } break;
            default:
                throw utils.exhausted(message);
        }
    }

    private requestInitialState() {
        this.sendRequest({ type: 'get_initial_state', payload: {} });
    }

    private render() {
        if (this.action === 'import') {
            return;
        }
        if (this.viewMode === 'group' && this.groupViewNodeId) {
            const groupNode = this.state.nodes.get(this.groupViewNodeId);
            if (groupNode) {
                this.renderGroupLayout(groupNode.bid);
            }
        } else {
            const windowNodes = (Array.from(this.state.nodes.values())
                .filter(n => n.type === 'window') as WindowData[])
                .sort((a, b) => {
                    if (a.closed !== b.closed) {
                        return a.closed ? 1 : -1;
                    }
                    if (a.name.is_custom !== b.name.is_custom) {
                        return a.name.is_custom ? -1 : 1;
                    }
                    return a.name.generation - b.name.generation;
                });
            this.renderOverviewLayout(windowNodes);
        }
    }

    private renderOverviewLayout(windowNodes: WindowData[]) {
        this.container.innerHTML = '';
        this.views.clear();

        for (const node of windowNodes) {
            this.addOrUpdateStateView(node.bid);
        }
    }

    private renderGroupLayout(nodeId: BruhId) {
        this.container.innerHTML = '';
        this.views.clear();
        this.addOrUpdateStateView(nodeId);
    }

    private addOrUpdateStateView(nodeId: BruhId) {
        let view = this.views.get(nodeId);
        if (!view) {
            const windowViewWrapper = document.createElement('div');
            windowViewWrapper.className = 'window-view';
            windowViewWrapper.dataset.stateId = nodeId.toString();
            this.container.appendChild(windowViewWrapper);
            if (!this.port) return;
            const viewType = this.viewMode === 'group' ? 'group' : 'window';
            view = new TabTreeView(windowViewWrapper, this.port, "overview", viewType);
            this.views.set(nodeId, view);
        }
        view.render(this.state, nodeId);
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
                                this.sendRequest({ type: 'convert_sideberry_export', payload: { data: data as SideberryExport } });
                            } else if (data.timestamp) { // Bruh format
                                this.sendAction({ type: 'load_bruh_export', payload: { data: data as BruhExport } });
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
}

document.addEventListener('DOMContentLoaded', async () => {
    const page = new OverviewPage('overview-container');
    await page.handle_events();
});
