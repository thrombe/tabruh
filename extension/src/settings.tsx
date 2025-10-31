// settings.tsx
import './settings.css';
import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import browser from 'webextension-polyfill';
import { TabTreeView } from './components/TabTreeView';
import { StateProvider, useStateContext } from './components/StateProvider';
import type { AppRequest, BruhExport, SideberryExport, Snapshot, UserConfig, WindowId } from './types';

const SettingsView: React.FC = () => {
    const { state, sendAction, sendRequest } = useStateContext();
    if (!state || !state.user_config) return null;

    const userConfig = state.user_config;

    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const target = e.target;
        sendAction({ type: 'update_user_config', payload: { config: { [target.id]: target.checked } as Partial<UserConfig> } });
    };

    const handleExport = () => {
        sendRequest({ type: 'export_data', payload: {} });
    };

    const handleImport = () => {
        openFilePicker(false, sendRequest, sendAction);
    };

    return (
        <div className="settings-view-container">
            <div className="settings-section">
                <h2 className="settings-title">General</h2>
                <div className="setting-item">
                    <label htmlFor="open_sidebar_on_new_windows">Open sidebar automatically on new windows</label>
                    <input type="checkbox" id="open_sidebar_on_new_windows" checked={userConfig.open_sidebar_on_new_windows} onChange={handleCheckboxChange} />
                </div>
            </div>
            <div className="settings-section">
                <h2 className="settings-title">Import / Export</h2>
                <div className="setting-item">
                    <div>
                        <label>Export Current State</label>
                        <p className="description">Save a snapshot of all your current open and closed windows to a JSON file.</p>
                    </div>
                    <button id="export-btn" className="button" onClick={handleExport}>Export</button>
                </div>
                <div className="setting-item">
                    <div>
                        <label>Import to Current State</label>
                        <p className="description">Import windows from a Tabruh or Sideberry export file as new, closed windows.</p>
                    </div>
                    <button id="import-btn" className="button" onClick={handleImport}>Import</button>
                </div>
            </div>
            <div className="settings-section">
                <h2 className="settings-title">Debugging</h2>
                <div className="setting-item">
                    <label htmlFor="dbg_reset_state_on_load">Reset state on every extension load (DANGEROUS)</label>
                    <input type="checkbox" id="dbg_reset_state_on_load" checked={userConfig.dbg_reset_state_on_load} onChange={handleCheckboxChange} />
                </div>
                <div className="setting-item">
                    <label htmlFor="dbg_log_events">Log browser events to console</label>
                    <input type="checkbox" id="dbg_log_events" checked={userConfig.dbg_log_events} onChange={handleCheckboxChange} />
                </div>
                <div className="setting-item">
                    <label htmlFor="dbg_log_effects">Log extension effects to console</label>
                    <input type="checkbox" id="dbg_log_effects" checked={userConfig.dbg_log_effects} onChange={handleCheckboxChange} />
                </div>
            </div>
        </div>
    );
};

const openFilePicker = (isForSnapshot: boolean, sendRequest: any, sendAction: any) => {
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
                    if (name) sendAction({ type: 'import_file_as_snapshot', payload: { data, name } });
                } else {
                    if ('id' in data) {
                        sendRequest({ type: 'convert_sideberry_export', payload: { data: data as SideberryExport } });
                    } else {
                        sendAction({ type: 'load_bruh_export', payload: { data: data as BruhExport } });
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
};

const SnapshotsView: React.FC<{ currentWindowId?: WindowId }> = ({ currentWindowId }) => {
    const { state, sendAction, sendRequest } = useStateContext();
    const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);

    const handleCreateSnapshot = () => {
        const name = prompt('Enter a name for the new snapshot:', new Date().toLocaleString());
        if (name) sendAction({ type: 'create_snapshot', payload: { name } });
    };

    const handleImportSnapshot = () => {
        openFilePicker(true, sendRequest, sendAction);
    };

    const snapshots = state ? [...state.snapshots].sort((a, b) => b.timestamp.localeCompare(a.timestamp)) : [];
    const selectedSnapshot = snapshots.find(s => s.id === selectedSnapshotId);

    return (
        <>
            <div className="snapshots-list-pane">
                <div className="snapshots-header">
                    <h2 className="settings-title" style={{ marginBottom: 0 }}>Snapshots</h2>
                    <div className="button-group">
                        <button className="button" onClick={handleCreateSnapshot}>Create</button>
                        <button className="button" onClick={handleImportSnapshot}>Import</button>
                    </div>
                </div>
                {snapshots.map(snapshot => (
                    <div
                        key={snapshot.id}
                        className={`snapshot-item ${snapshot.id === selectedSnapshotId ? 'selected' : ''}`}
                        onClick={() => setSelectedSnapshotId(snapshot.id)}
                    >
                        <div className="truncate">
                            <div className="snapshot-name">{snapshot.name}</div>
                            <div className="snapshot-date">{new Date(snapshot.timestamp).toLocaleString()}</div>
                        </div>
                    </div>
                ))}
            </div>
            <div className="snapshots-detail-pane">
                {selectedSnapshot ? (
                    selectedSnapshot.data.windows.map((windowData, windowIndex) => (
                        <div key={`${selectedSnapshot.id}-${windowIndex}`} className="snapshot-window-view">
                            <TabTreeView
                                treeType="snapshot"
                                mode="snapshot"
                                snapshotWindow={windowData}
                                snapshotId={selectedSnapshot.id}
                                windowIndex={windowIndex}
                                currentWindowId={currentWindowId}
                            />
                        </div>
                    ))
                ) : (
                    <div className="no-snapshot-selected">Select a snapshot to view its contents</div>
                )}
            </div>
        </>
    );
};

const SettingsPage: React.FC = () => {
    const [currentView, setCurrentView] = useState<'settings' | 'snapshots'>('settings');
    const [currentWindowId, setCurrentWindowId] = useState<WindowId | undefined>();

    useEffect(() => {
        browser.windows.getCurrent().then(win => {
            setCurrentWindowId(win.id as WindowId);
        });
    }, []);

    const renderContent = () => {
        switch (currentView) {
            case 'settings':
                return <SettingsView />;
            case 'snapshots':
                return <SnapshotsView currentWindowId={currentWindowId} />;
            default:
                return null;
        }
    };

    return (
        <div style={{ display: 'flex', height: '100vh' }}>
            <div className="sidebar">
                <button
                    className={`sidebar-button ${currentView === 'settings' ? 'active' : ''}`}
                    onClick={() => setCurrentView('settings')}
                >
                    Settings
                </button>
                <button
                    className={`sidebar-button ${currentView === 'snapshots' ? 'active' : ''}`}
                    onClick={() => setCurrentView('snapshots')}
                >
                    Snapshots
                </button>
            </div>
            <div id="content" className="content">
                {renderContent()}
            </div>
        </div>
    );
};

document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('settings-root');
    if (!container) return;

    const root = ReactDOM.createRoot(container);
    root.render(
        <React.StrictMode>
            <StateProvider connectionName="settings-page">
                <SettingsPage />
            </StateProvider>
        </React.StrictMode>
    );
});
