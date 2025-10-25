import './settings.css';
import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view';
import type { BackgroundRequest, BackgroundResponse, BruhExport, SideberryExport, Snapshot, UiStateForRender, UserConfig, WindowId } from './types';

const ICON_RESTORE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/><path d="m21 3-9 9"/><path d="M15 3h6v6"/></svg>`;
const ICON_TRASH = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
const ICON_EXPORT = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

class SettingsPage {
    private port: browser.Runtime.Port;
    private contentContainer: HTMLElement;
    private currentView: 'settings' | 'snapshots' = 'settings';
    private snapshots: Snapshot[] = [];
    private selectedSnapshotId: string | null = null;
    private userConfig: UserConfig | null = null;
    private currentWindowId?: WindowId;

    constructor() {
        this.contentContainer = document.getElementById('content')!;
        this.port = browser.runtime.connect({ name: 'settings-page' });

        this.port.onMessage.addListener(msg => this.handleMessage(msg as BackgroundResponse));
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

        this.sendMessage({ type: 'get_user_config', payload: {} });
        this.sendMessage({ type: 'get_snapshots', payload: {} });

        this.render();
    }

    private sendMessage(message: BackgroundRequest) {
        this.port.postMessage(message);
    }

    private handleMessage(message: BackgroundResponse) {
        switch (message.type) {
            case 'snapshots_list_update':
                this.snapshots = message.payload.snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
                if (this.currentView === 'snapshots') {
                    this.render();
                }
                break;
            case 'user_config_update':
                this.userConfig = message.payload.config;
                if (this.currentView === 'settings') {
                    this.render();
                }
                break;
            case 'converted_sideberry_export_ready': {
                this.sendMessage({ type: 'load_bruh_export', payload: { data: message.payload.data } });
                alert('Sideberry data imported successfully! Your imported windows have been added as closed windows.');
            } break;
            case 'state_update':
                if (message.payload.state.is_read_only) {
                    this.renderSingleSnapshotWindow(message.payload.state);
                }
                break;
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
        if (!this.userConfig) return;

        const container = document.createElement('div');
        container.className = 'settings-view-container';

        container.innerHTML = `
            <div class="settings-section">
                <h2 class="settings-title">General</h2>
                <div class="setting-item">
                    <label for="open_sidebar_on_new_windows">Open sidebar automatically on new windows</label>
                    <input type="checkbox" id="open_sidebar_on_new_windows" ${this.userConfig.open_sidebar_on_new_windows ? 'checked' : ''}>
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
                    <input type="checkbox" id="dbg_reset_state_on_load" ${this.userConfig.dbg_reset_state_on_load ? 'checked' : ''}>
                </div>
                <div class="setting-item">
                    <label for="dbg_log_events">Log browser events to console</label>
                    <input type="checkbox" id="dbg_log_events" ${this.userConfig.dbg_log_events ? 'checked' : ''}>
                </div>
                <div class="setting-item">
                    <label for="dbg_log_effects">Log extension effects to console</label>
                    <input type="checkbox" id="dbg_log_effects" ${this.userConfig.dbg_log_effects ? 'checked' : ''}>
                </div>
            </div>
        `;

        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                this.sendMessage({ type: 'update_user_config', payload: { config: { [target.id]: target.checked } } });
            });
        });

        container.querySelector('#export-btn')!.addEventListener('click', () => {
            this.sendMessage({ type: 'export_data', payload: {} });
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
                this.sendMessage({ type: 'create_snapshot', payload: { name } });
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

        this.snapshots.forEach(snapshot => {
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

        const selectedSnapshot = this.snapshots.find(s => s.id === this.selectedSnapshotId);
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
                            this.sendMessage({ type: 'import_file_as_snapshot', payload: { data, name } });
                        }
                    } else {
                        if ('id' in data) { // Sideberry
                            this.sendMessage({ type: 'convert_sideberry_export', payload: { data: data as SideberryExport } });
                        } else { // Tabruh
                            this.sendMessage({ type: 'load_bruh_export', payload: { data: data as BruhExport } });
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
        snapshot.data.windows.forEach((_, windowIndex) => {
            const viewContainer = document.createElement('div');
            viewContainer.className = 'snapshot-window-view';
            viewContainer.dataset.snapshotId = snapshot.id;
            viewContainer.dataset.windowIndex = String(windowIndex);
            viewContainer.innerHTML = '<div>Loading...</div>';
            container.appendChild(viewContainer);

            this.sendMessage({
                type: 'get_state_for_snapshot_window',
                payload: { snapshot_id: snapshot.id, window_index: windowIndex }
            });
        });
    }

    private renderSingleSnapshotWindow(state: UiStateForRender) {
        const { snapshot_id, window_index } = state;
        if (snapshot_id === undefined || window_index === undefined) return;

        const viewContainer = this.contentContainer.querySelector<HTMLElement>(
            `.snapshot-window-view[data-snapshot-id="${snapshot_id}"][data-window-index="${window_index}"]`
        );

        if (viewContainer) {
            viewContainer.innerHTML = '';
            const treeView = new TabTreeView(viewContainer, this.port, "snapshot", 'window', this.currentWindowId);
            treeView.render(state);
        }
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

        createItem('Restore All Windows', ICON_RESTORE, () => {
            this.sendMessage({ type: 'load_bruh_export', payload: { data: snapshot.data } });
            alert(`Restored ${snapshot.data.windows.length} window(s) from snapshot "${snapshot.name}". They are available in your closed windows list.`);
        });

        createItem('Export Snapshot', ICON_EXPORT, () => {
            this.sendMessage({ type: "export_data", payload: {} });
        });

        createSeparator();

        createItem('Delete Snapshot', ICON_TRASH, () => {
            if (confirm(`Delete snapshot "${snapshot.name}"? This cannot be undone.`)) {
                if (this.selectedSnapshotId === snapshot.id) this.selectedSnapshotId = null;
                this.sendMessage({ type: 'delete_snapshot', payload: { id: snapshot.id } });
            }
        });

        this.positionContextMenu(menu, x, y);
    }
}

new SettingsPage();
