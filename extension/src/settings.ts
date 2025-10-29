import './settings.css';
import browser from 'webextension-polyfill';
import * as svg from './svg';
import { TabTreeView } from './tab_tree_view';
import * as utils from './utils';
import { State } from './state';
import type {
    AppRequest,
    AppResponse,
    BruhExport,
    StateAction,
    SideberryExport,
    Snapshot,
    UserConfig,
    WindowId,
    ExtensionAction,
    BruhUiEvent,
    StateEvent,
    StateEffect,
    AppEffect
} from './types';


class SettingsPage {
    private port: browser.Runtime.Port;
    private contentContainer: HTMLElement;
    private currentView: 'settings' | 'snapshots' = 'settings';
    private selectedSnapshotId: string | null = null;
    private currentWindowId?: WindowId;

    private state: State;
    private ui_events: utils.Channel<BruhUiEvent>;
    private app_effects: utils.Deque<AppEffect>;


    constructor() {
        this.contentContainer = document.getElementById('content')!;
        this.port = browser.runtime.connect({ name: 'settings-page' });

        this.state = new State("0.0");
        this.ui_events = new utils.Channel();
        this.app_effects = new utils.Deque();

        this.port.onMessage.addListener(async msg => await this.ui_events.send(msg as BruhUiEvent));
        this.port.onDisconnect.addListener(() => console.error("Settings page disconnected."));

        browser.windows.getCurrent().then(win => {
            this.currentWindowId = win.id as WindowId;
        });

        document.querySelectorAll('.sidebar-button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelector('.sidebar-button.active')?.classList.remove('active');
                btn.classList.add('active');
                this.currentView = btn.getAttribute('data-view') as 'settings' | 'snapshots';
                this.render();
            });
        });

        this.requestInitialState();
        this.handle_events();
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
        this.port.postMessage(message);
    }

    private handle_event(event: StateEvent) {
        this.state.handle_event(event, this.app_effects);
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
                    case 'initial_state':
                        this.state = State.from_clonable_state(message.payload.payload);

                        // @ts-ignore
                        globalThis.state = this.state;
                        break;
                    case 'converted_sideberry_export_ready': {
                        this.sendAction({ type: 'load_bruh_export', payload: { data: message.payload.payload.data } });
                        alert('Sideberry data imported successfully! Your imported windows have been added as closed windows.');
                    } break;
                    case 'snapshots_list_update':
                        this.state.snapshots = message.payload.payload.snapshots;
                        break;
                }
            } break;
            default:
                throw utils.exhausted(message);
        }
    }

    private render() {
        this.contentContainer.innerHTML = '';
        if (this.currentView === 'settings') {
            this.renderSettingsView();
        } else if (this.currentView === 'snapshots') {
            this.renderSnapshotsView();
        }
    }

    private renderSettingsView() {
        const userConfig = this.state.user_config;
        if (!userConfig) return;

        const container = document.createElement('div');
        container.className = 'settings-view-container';

        container.innerHTML = `
            <div class="settings-section">
                <h2 class="settings-title">General</h2>
                <div class="setting-item">
                    <label for="open_sidebar_on_new_windows">Open sidebar automatically on new windows</label>
                    <input type="checkbox" id="open_sidebar_on_new_windows" ${userConfig.open_sidebar_on_new_windows ? 'checked' : ''}>
                </div>
            </div>
            <div class="settings-section">
                <h2 class="settings-title">Import / Export</h2>
                <div class="setting-item">
                    <div>
                        <label>Export Current State</label>
                        <p class="description">Save a snapshot of all your current open and closed windows to a JSON file.</p>
                    </div>
                    <button id="export-btn" class="button">Export</button>
                </div>
                <div class="setting-item">
                    <div>
                        <label>Import to Current State</label>
                        <p class="description">Import windows from a Tabruh or Sideberry export file as new, closed windows.</p>
                    </div>
                    <button id="import-btn" class="button">Import</button>
                </div>
            </div>
            <div class="settings-section">
                <h2 class="settings-title">Debugging</h2>
                <div class="setting-item">
                    <label for="dbg_reset_state_on_load">Reset state on every extension load (DANGEROUS)</label>
                    <input type="checkbox" id="dbg_reset_state_on_load" ${userConfig.dbg_reset_state_on_load ? 'checked' : ''}>
                </div>
                <div class="setting-item">
                    <label for="dbg_log_events">Log browser events to console</label>
                    <input type="checkbox" id="dbg_log_events" ${userConfig.dbg_log_events ? 'checked' : ''}>
                </div>
                <div class="setting-item">
                    <label for="dbg_log_effects">Log extension effects to console</label>
                    <input type="checkbox" id="dbg_log_effects" ${userConfig.dbg_log_effects ? 'checked' : ''}>
                </div>
            </div>
        `;

        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                this.sendAction({ type: 'update_user_config', payload: { config: { [target.id]: target.checked } as Partial<UserConfig> } });
            });
        });

        container.querySelector('#export-btn')!.addEventListener('click', () => {
            this.sendRequest({ type: 'export_data', payload: {} });
        });

        container.querySelector('#import-btn')!.addEventListener('click', () => {
            this.openFilePicker(false); // false = not a snapshot, import to current state
        });

        this.contentContainer.appendChild(container);
    }

    private renderSnapshotsView() {
        const listPane = document.createElement('div');
        listPane.className = 'snapshots-list-pane';

        const detailPane = document.createElement('div');
        detailPane.className = 'snapshots-detail-pane';

        const header = document.createElement('div');
        header.className = 'snapshots-header';
        header.innerHTML = `<h2 class="settings-title" style="margin-bottom: 0;">Snapshots</h2>`;

        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'button-group';

        const createBtn = document.createElement('button');
        createBtn.textContent = 'Create';
        createBtn.className = 'button';
        createBtn.onclick = () => {
            const name = prompt('Enter a name for the new snapshot:', new Date().toLocaleString());
            if (name) {
                this.sendAction({ type: 'create_snapshot', payload: { name } });
            }
        };

        const importBtn = document.createElement('button');
        importBtn.textContent = 'Import';
        importBtn.className = 'button';
        importBtn.onclick = () => {
            this.openFilePicker(true);
        };

        buttonGroup.append(createBtn, importBtn);
        header.appendChild(buttonGroup);
        listPane.appendChild(header);

        const snapshots = [...this.state.snapshots].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        snapshots.forEach(snapshot => {
            const item = document.createElement('div');
            item.className = 'snapshot-item';
            if (snapshot.id === this.selectedSnapshotId) item.classList.add('selected');

            item.innerHTML = `
                <div class="truncate">
                    <div class="snapshot-name">${snapshot.name}</div>
                    <div class="snapshot-date">${new Date(snapshot.timestamp).toLocaleString()}</div>
                </div>
                <button class="snapshot-menu-btn">&#x22EE;</button>
            `;

            item.addEventListener('click', () => {
                this.selectedSnapshotId = snapshot.id;
                this.render();
            });

            item.querySelector('.snapshot-menu-btn')!.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showSnapshotContextMenu(e.clientX, e.clientY, snapshot);
            });

            listPane.appendChild(item);
        });

        const selectedSnapshot = snapshots.find(s => s.id === this.selectedSnapshotId);
        if (selectedSnapshot) {
            this.renderSnapshotDetail(detailPane, selectedSnapshot);
        } else {
            detailPane.innerHTML = `<div class="no-snapshot-selected">Select a snapshot to view its contents</div>`;
        }

        this.contentContainer.append(listPane, detailPane);
    }

    private openFilePicker(isForSnapshot: boolean) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = e.target?.result as string;
                    const data = JSON.parse(content);

                    if (!('id' in data || 'timestamp' in data)) {
                        alert('Unrecognized export format.');
                        return;
                    }

                    if (isForSnapshot) {
                        const name = prompt(`Enter a name for the imported snapshot:`, file.name.replace('.json', ''));
                        if (name) {
                            this.sendAction({ type: 'import_file_as_snapshot', payload: { data, name } });
                        }
                    } else {
                        if ('id' in data) { // Sideberry
                            this.sendRequest({ type: 'convert_sideberry_export', payload: { data: data as SideberryExport } });
                        } else { // Tabruh
                            this.sendAction({ type: 'load_bruh_export', payload: { data: data as BruhExport } });
                            alert('Import successful! Your imported windows have been added as closed windows.');
                        }
                    }
                } catch (err) {
                    console.error('Error importing file:', err);
                    alert('Failed to read or parse the import file.');
                }
            };
            reader.readAsText(file);
        };

        input.click();
    }

    private renderSnapshotDetail(container: HTMLElement, snapshot: Snapshot) {
        container.innerHTML = '';
        snapshot.data.windows.forEach((windowData, windowIndex) => {
            const viewContainer = document.createElement('div');
            viewContainer.className = 'snapshot-window-view';
            container.appendChild(viewContainer);
            const treeView = new TabTreeView(viewContainer, this.port, "snapshot", 'window', this.currentWindowId);
            treeView.renderSnapshot(windowData, snapshot.id, windowIndex);
        });
    }

    // Context Menu Logic
    private removeContextMenu = () => {
        document.getElementById('context-menu')?.remove();
        document.removeEventListener('click', this.removeContextMenu);
        document.removeEventListener('contextmenu', this.removeContextMenu);
        window.removeEventListener('blur', this.removeContextMenu);
    }

    private createContextMenuElement(x: number, y: number): HTMLDivElement {
        this.removeContextMenu();
        const menu = document.createElement('div');
        menu.id = 'context-menu';
        menu.className = 'context-menu';
        menu.style.visibility = 'hidden';
        document.body.appendChild(menu);
        return menu;
    }

    private positionContextMenu(menu: HTMLElement, x: number, y: number) {
        setTimeout(() => {
            const menuWidth = menu.offsetWidth;
            const menuHeight = menu.offsetHeight;
            let finalX = x;
            if (x + menuWidth > window.innerWidth) finalX = x - menuWidth;
            let finalY = y;
            if (y + menuHeight > window.innerHeight) finalY = y - menuHeight;
            menu.style.left = `${finalX < 0 ? 5 : finalX}px`;
            menu.style.top = `${finalY < 0 ? 5 : finalY}px`;
            menu.style.visibility = 'visible';

            document.addEventListener('click', this.removeContextMenu, { once: true });
            document.addEventListener('contextmenu', this.removeContextMenu, { once: true });
            window.addEventListener('blur', this.removeContextMenu, { once: true });
        }, 0);
    }

    private showSnapshotContextMenu(x: number, y: number, snapshot: Snapshot) {
        const menu = this.createContextMenuElement(x, y);

        const createItem = (label: string, icon: string, action: () => void) => {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            item.innerHTML = `<span class="context-menu-icon">${icon}</span><span>${label}</span>`;
            item.addEventListener('click', (e) => { e.stopPropagation(); action(); this.removeContextMenu(); });
            menu.appendChild(item);
        };

        const createSeparator = () => {
            const separator = document.createElement('hr');
            separator.className = 'context-menu-separator';
            menu.appendChild(separator);
        };

        createItem('Restore All Windows', svg.icon_restore, () => {
            this.sendAction({ type: 'load_bruh_export', payload: { data: snapshot.data } });
            alert(`Restored ${snapshot.data.windows.length} window(s) from snapshot "${snapshot.name}". They are available in your closed windows list.`);
        });

        createItem('Export Snapshot', svg.icon_export, () => {
            this.sendRequest({ type: "export_data", payload: {} });
        });

        createSeparator();

        createItem('Delete Snapshot', svg.icon_trash, () => {
            if (confirm(`Delete snapshot "${snapshot.name}"? This cannot be undone.`)) {
                if (this.selectedSnapshotId === snapshot.id) this.selectedSnapshotId = null;
                this.sendAction({ type: 'delete_snapshot', payload: { id: snapshot.id } });
            }
        });

        this.positionContextMenu(menu, x, y);
    }
}

new SettingsPage();
