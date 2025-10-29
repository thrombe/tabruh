import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import * as utils from './utils';
import { State } from './state';
import type {
    AppRequest,
    AppResponse,
    ExtensionAction,
    StateAction,
    WindowId,
    BruhUiEvent,
    StateEvent,
    StateEffect,
    AppEffect
} from './types';

class TabTreeSidebar {
    private port: browser.Runtime.Port;
    private view: TabTreeView | null = null;
    private windowId: WindowId | undefined;

    private state: State;
    private ui_events: utils.Channel<BruhUiEvent>;
    private state_effects: utils.Deque<StateEffect>;
    private app_effects: utils.Deque<AppEffect>;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Sidebar container #${containerId} not found.`);

        this.state = new State("0.0");
        this.ui_events = new utils.Channel();
        this.state_effects = new utils.Deque();
        this.app_effects = new utils.Deque();

        this.port = browser.runtime.connect({ name: 'sidebar-connection' });
        this.init(el);
        this.handle_events();
    }

    private async init(container: HTMLElement) {
        const win = await browser.windows.getCurrent();
        this.windowId = win.id as WindowId;

        if (!this.windowId) {
            console.error("Could not determine window ID for the sidebar.");
            return;
        }

        this.view = new TabTreeView(container, this.port, "sidebar", 'window', this.windowId);

        this.port.onMessage.addListener(async message => await this.ui_events.send(message as BruhUiEvent));
        this.port.onDisconnect.addListener(() => console.error("Sidebar disconnected from background script."));

        this.requestInitialState();
    }

    private requestInitialState() {
        this.sendRequest({ type: 'get_initial_state', payload: {} });
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

    private handle_event(event: StateEvent) {
        this.state.handle_event(event, this.state_effects, this.app_effects);
        while (true) {
            const effect = this.state_effects.pop_front();
            if (!effect) break;
            this.state.handle_effect(effect, this.state_effects, this.app_effects);
        }
        this.app_effects.clear();
    }

    private async handle_events() {
        while (true) {
            const event = await this.ui_events.wait_recv();
            if (!event) break;
            this.handleMessage(event);
            this.render();
        }
    }

    private render() {
        if (!this.view || !this.windowId) return;

        const wbid = this.state.window_bids.get(this.windowId);
        if (wbid) {
            this.view.render(this.state, wbid);
        } else {
            const container = document.getElementById('tree-container');
            if (container) container.innerHTML = '';
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
                    case 'converted_sideberry_export_ready':
                    case 'snapshots_list_update':
                        // sidebar doesn't care about these
                        break;
                }
            } break;
            default:
                throw utils.exhausted(message);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new TabTreeSidebar('tree-container');
});
