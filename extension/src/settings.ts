import './settings.css';
import browser from 'webextension-polyfill';
import { TabTreeView } from './tab_tree_view.ts';
import type { BackgroundPortRequest, BackgroundResponse, BruhExport, Snapshot, UiNode, UiStateForRender, UserConfig } from './types';

class SettingsPage {
    private port: browser.Runtime.Port;
    private contentContainer: HTMLElement;
    private currentView: 'settings' | 'snapshots' = 'settings';
    private snapshots: Snapshot[] = [];
    private selectedSnapshotId: string | null = null;
    private userConfig: UserConfig | null = null;

    constructor() {
        this.contentContainer = document.getElementById('content')!;
        this.port = browser.runtime.connect({ name: 'settings-page' });

        this.port.onMessage.addListener(msg => this.handleMessage(msg as BackgroundResponse));
        this.port.onDisconnect.addListener(() => console.error("Settings page disconnected."));

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

    private sendMessage(message: BackgroundPortRequest) {
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

        this.contentContainer.appendChild(container);
    }

    private renderSnapshotsView() {
        const listPane = document.createElement('div');
        listPane.className = 'snapshots-list-pane';

        const detailPane = document.createElement('div');
        detailPane.className = 'snapshots-detail-pane';

        // Header and "Create" button
        const header = document.createElement('div');
        header.className = 'snapshots-header';
        header.innerHTML = `<h2 class="settings-title" style="margin-bottom: 0;">Snapshots</h2>`;
        const createBtn = document.createElement('button');
        createBtn.textContent = 'Create New';
        createBtn.className = 'button';
        createBtn.onclick = () => {
            const name = prompt('Enter a name for the new snapshot:', new Date().toLocaleString());
            if (name) {
                this.sendMessage({ type: 'create_snapshot', payload: { name } });
            }
        };
        header.appendChild(createBtn);
        listPane.appendChild(header);

        // Snapshots list
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

            // Context menu logic
            item.querySelector('.snapshot-menu-btn')!.addEventListener('click', (e) => {
                e.stopPropagation();
                // TODO: Implement a proper context menu component if desired
                const action = confirm(`Delete snapshot "${snapshot.name}"? This cannot be undone.`);
                if (action) {
                    if (this.selectedSnapshotId === snapshot.id) this.selectedSnapshotId = null;
                    this.sendMessage({ type: 'delete_snapshot', payload: { id: snapshot.id } });
                }
            });

            listPane.appendChild(item);
        });

        // Detail pane content
        const selectedSnapshot = this.snapshots.find(s => s.id === this.selectedSnapshotId);
        if (selectedSnapshot) {
            this.renderSnapshotDetail(detailPane, selectedSnapshot);
        } else {
            detailPane.innerHTML = `<div class="no-snapshot-selected">Select a snapshot to view its contents</div>`;
        }

        this.contentContainer.append(listPane, detailPane);
    }

    private renderSnapshotDetail(container: HTMLElement, snapshot: Snapshot) {
        container.innerHTML = '';
        snapshot.data.windows.forEach((win, windowIndex) => {
            const state = this.convertBruhExportWindowToUiState(snapshot.id, windowIndex, win, snapshot.data);

            const viewContainer = document.createElement('div');
            viewContainer.style.marginBottom = '1rem';

            const treeView = new TabTreeView(viewContainer, this.port, false, 'window', true);
            treeView.render(state);
            container.appendChild(viewContainer);
        });
    }

    private convertBruhExportWindowToUiState(snapshotId: string, windowIndex: number, windowData: BruhExport['windows'][number], fullExport: BruhExport): UiStateForRender {
        const tree = new Map<number, UiNode>();
        const rootBids: number[] = [];

        // Use array indices as temporary BruhIds
        windowData.tabs.forEach((tab, index) => {
            const children: number[] = [];
            // Find children for this tab
            for (let i = 0; i < windowData.tabs.length; i++) {
                if (windowData.tabs[i]!.parent_index === index) {
                    children.push(i);
                }
            }

            const isGroup = tab.url.includes('/overview.html?view=group');

            tree.set(index, {
                id: index as any,
                tab_index: index,
                title: tab.title,
                url: tab.url,
                // favIconUrl can't be known from export
                isGroup,
                isDiscarded: true,
                isActive: false,
                isCollapsed: false, // Snapshots don't store this, default to open
                children: children as any,
            });

            if (tab.parent_index === null) {
                rootBids.push(index);
            }
        });

        return {
            id: windowIndex as any,
            wbid: windowIndex as any,
            name: windowData.name || 'Unnamed Window',
            is_custom_named: !!windowData.name,
            is_closed: true, // All snapshot windows are treated as closed/archived
            generation: 0,
            tree: tree as any,
            root_bids: rootBids as any,
            is_read_only: true,
            snapshot_id: snapshotId,
            window_index: windowIndex
        };
    }
}

new SettingsPage();
