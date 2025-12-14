import './settings.css';
import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import ReactDOM from 'react-dom/client';
import browser from 'webextension-polyfill';
import { TabTreeView } from './components/TabTreeView';
import { StateProvider, useStateContext } from './components/StateProvider';
import type { AppRequest, BruhExport, SideberryExport, Snapshot, UserConfig, WindowId, BruhUiEvent, StateAction, WindowData} from './types';
import { ContextMenuPortal, useContextMenu } from './hooks/useContextMenu';
import * as svg from './svg';
import * as utils from './utils';

const openFilePicker = (isForSnapshot: boolean, sendRequest: (req: AppRequest) => void, sendAction: (act: any) => void) => {
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

const DangerousSettings: React.FC = () => {
    const { sendRequest } = useStateContext();
    const [unlocked, setUnlocked] = useState(false);

    const handleAction = (type: AppRequest['type']) => {
        if (!confirm(`Are you sure you want to trigger '${type}'? This action can lead to data loss and cannot be undone.`)) return;
        sendRequest({ type, payload: {} });
    };

    return (
        <div className="settings-section dangerous-section">
            <div className="settings-title-container">
                <h2 className="settings-title">Dangerous Settings</h2>
                <div className="toggle-container">
                    <label htmlFor="unlock-dangerous" className="text-sm font-semibold">Enable Actions</label>
                    <input id="unlock-dangerous" type="checkbox" checked={unlocked} onChange={(e) => setUnlocked(e.target.checked)} />
                </div>
            </div>
            <div className="setting-item">
                <div>
                    <label>Re-initialize from Storage</label>
                    <p className="description">Forces a full reload of the extension's state from local storage. Use if state seems corrupted.</p>
                </div>
                <button className="button danger-btn setting" disabled={!unlocked} onClick={() => handleAction('reinit_from_storage')}>Re-init</button>
            </div>
            <div className="setting-item">
                <div>
                    <label>Reset State</label>
                    <p className="description">Wipes all window, group, and tab data, starting fresh. Your open tabs will be lost.</p>
                </div>
                <button className="button danger-btn setting" disabled={!unlocked} onClick={() => handleAction('reset_state')}>Reset State</button>
            </div>
            <div className="setting-item">
                <div>
                    <label>Reset Configuration</label>
                    <p className="description">Resets all your customized settings on this page to their default values.</p>
                </div>
                <button className="button danger-btn setting" disabled={!unlocked} onClick={() => handleAction('reset_config')}>Reset Config</button>
            </div>
            <div className="setting-item">
                <div>
                    <label>Reset Snapshots</label>
                    <p className="description">Permanently deletes all of your saved snapshots.</p>
                </div>
                <button className="button danger-btn setting" disabled={!unlocked} onClick={() => handleAction('reset_snapshots')}>Reset Snapshots</button>
            </div>
        </div>
    );
};

const SettingsView: React.FC = () => {
    const { state, sendAction, sendRequest } = useStateContext();
    
    // Use local state for the text input to avoid re-renders on every keystroke.
    const [newTabUrl, setNewTabUrl] = useState(state?.user_config.new_tab_url || '');
    const [restoreCacheSize, setRestoreCacheSize] = useState(state?.user_config.restore_cache_size.toString() || '1000');

    // Sync local state if the global state changes from another source.
    useEffect(() => {
        if (state) {
            setNewTabUrl(state.user_config.new_tab_url || '');
            setRestoreCacheSize(state.user_config.restore_cache_size.toString());
        }
    }, [state?.user_config.new_tab_url, state?.user_config.restore_cache_size]);

    if (!state || !state.user_config) return null;

    const userConfig = state.user_config;

    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const target = e.target;
        sendAction({ type: 'update_user_config', payload: { config: { [target.id]: target.checked } as Partial<UserConfig> } });
    };
    
    // Save the new tab URL state only on blur or Enter.
    const handleSaveNewTabUrl = () => {
        if (state && newTabUrl !== state.user_config.new_tab_url) {
            sendAction({ type: 'update_user_config', payload: { config: { new_tab_url: newTabUrl } } });
        }
    };

    const handleUrlInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur(); // Triggers the onBlur event to save
        }
    };

    const handleSaveRestoreCacheSize = () => {
        const newSize = parseInt(restoreCacheSize, 10);
        if (!isNaN(newSize) && newSize >= 0 && state && newSize !== state.user_config.restore_cache_size) {
            sendAction({ type: 'update_user_config', payload: { config: { restore_cache_size: newSize } } });
        } else if (state) {
            setRestoreCacheSize(state.user_config.restore_cache_size.toString());
        }
    };

    const handleCacheSizeInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        }
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
                <div className="setting-item">
                    <div>
                        <label htmlFor="new_tab_url">Custom New Tab URL</label>
                        <p className="description">Redirect new tabs to this URL. Leave blank for the default page.</p>
                    </div>
                    <input
                        type="text"
                        id="new_tab_url"
                        className="text-input"
                        placeholder="https://example.com"
                        value={newTabUrl}
                        onChange={(e) => setNewTabUrl(e.target.value)}
                        onBlur={handleSaveNewTabUrl}
                        onKeyDown={handleUrlInputKeyDown}
                    />
                </div>
                <div className="setting-item">
                    <div>
                        <label htmlFor="restore_cache_size">Restore Cache Size</label>
                        <p className="description">Max number of closed tabs/windows to remember for restoration.</p>
                    </div>
                    <input
                        type="number"
                        id="restore_cache_size"
                        className="text-input"
                        min="0"
                        step="100"
                        value={restoreCacheSize}
                        onChange={(e) => setRestoreCacheSize(e.target.value)}
                        onBlur={handleSaveRestoreCacheSize}
                        onKeyDown={handleCacheSizeInputKeyDown}
                    />
                </div>
            </div>
            <div className="settings-section">
                <h2 className="settings-title">Import / Export</h2>
                <div className="setting-item">
                    <div>
                        <label>Export Current State</label>
                        <p className="description">Save a snapshot of all your current open and closed windows to a JSON file.</p>
                    </div>
                    <button id="export-btn" className="button setting" onClick={handleExport}>Export</button>
                </div>
                <div className="setting-item">
                    <div>
                        <label>Import to Current State</label>
                        <p className="description">Import windows from a Tabruh or Sideberry export file as new, closed windows.</p>
                    </div>
                    <button id="import-btn" className="button setting" onClick={handleImport}>Import</button>
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
                <div className="setting-item">
                    <label htmlFor="dbg_log_state_effects">Log extension state effects to console</label>
                    <input type="checkbox" id="dbg_log_state_effects" checked={userConfig.dbg_log_state_effects} onChange={handleCheckboxChange} />
                </div>
                <div className="setting-item">
                    <label htmlFor="dbg_log_state_actions">Log extension state actions to console</label>
                    <input type="checkbox" id="dbg_log_state_actions" checked={userConfig.dbg_log_state_actions} onChange={handleCheckboxChange} />
                </div>
            </div>
            <DangerousSettings />
        </div>
    );
};

const SnapshotsView: React.FC<{ currentWindowId?: WindowId }> = ({ currentWindowId }) => {
    const { state, sendAction, sendRequest } = useStateContext();
    const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
    const { menuState, showMenu, hideMenu } = useContextMenu();

    const handleCreateSnapshot = () => {
        const name = prompt('Enter a name for the new snapshot:', new Date().toLocaleString());
        if (name) sendAction({ type: 'create_snapshot', payload: { name } });
    };

    const handleImportSnapshot = () => {
        openFilePicker(true, sendRequest, sendAction);
    };

    const showSnapshotContextMenu = useCallback((x: number, y: number, snapshot: Snapshot) => {
        const createItem = (label: string, icon: string, action: () => void) => (
            <div className="context-menu-item" onClick={() => { action(); hideMenu(); }}>
                <span className="context-menu-icon" dangerouslySetInnerHTML={{ __html: icon }} />
                <span>{label}</span>
            </div>
        );

        const createSeparator = () => <div className="context-menu-separator" />;

        const content = (
            <>
                {createItem('Restore All Windows', svg.icon_restore, () => {
                    sendAction({ type: 'load_bruh_export', payload: { data: snapshot.data } });
                    alert(`Restored ${snapshot.data.windows.length} window(s) from snapshot "${snapshot.name}". They are available in your closed windows list.`);
                })}
                {createItem('Export Snapshot', svg.icon_export, () => {
                    const data = { ...snapshot.data, name: snapshot.name };
                    const jsonData = JSON.stringify(data, null, 2);
                    const blob = new Blob([jsonData], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const filename = `tabruh-snapshot-${snapshot.name.replace(/[^a-z0-9]/gi, '_')}.json`;
                    browser.downloads.download({ url, filename, saveAs: true });
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                })}
                {createSeparator()}
                {createItem('Delete Snapshot', svg.icon_trash, () => {
                    if (confirm(`Delete snapshot "${snapshot.name}"? This cannot be undone.`)) {
                        if (selectedSnapshotId === snapshot.id) setSelectedSnapshotId(null);
                        sendAction({ type: 'delete_snapshot', payload: { id: snapshot.id } });
                    }
                })}
            </>
        );

        showMenu(x, y, content);
    }, [sendAction, hideMenu, showMenu, selectedSnapshotId]);

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
                        <button
                            className="snapshot-menu-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                showSnapshotContextMenu(e.clientX, e.clientY, snapshot);
                            }}
                        >
                            &#x22EE;
                        </button>
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
            <ContextMenuPortal menuState={menuState} />
        </>
    );
};

const LogEntry: React.FC<{
    log: utils.Log;
    isTraceExpanded: boolean;
    isJsonExpanded: boolean;
    onToggleTrace: () => void;
    onToggleJson: () => void;
}> = ({ log, isTraceExpanded, isJsonExpanded, onToggleTrace, onToggleJson }) => {

    const hasExtra = Object.keys(log.extra).length > 0;
    const hasTrace = log.trace && log.trace.split('\n').length > 1;

    const formattedJson = useMemo(() => {
        return hasExtra ? JSON.stringify(log.extra, null, 2) : '';
    }, [log.extra, hasExtra]);

    return (
        <div className={`log-entry ${log.level.toLowerCase()}`}>
            <div className="log-header">
                <span className="log-timestamp">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                <span className={`log-level ${log.level}`}>{log.level}</span>
                <span className="log-msg" onClick={onToggleJson}>{log.msg}</span>
                {hasExtra && !isJsonExpanded && (
                    <span className="json-preview" onClick={onToggleJson}>{'{...}'}</span>
                )}
                {hasTrace && (
                    <span className="log-details-toggle" onClick={onToggleTrace}>
                        {isTraceExpanded ? 'hide trace' : 'show trace'}
                    </span>
                )}
            </div>

            {isTraceExpanded && hasTrace && (
                <div className="log-details"><pre>{log.trace}</pre></div>
            )}
            {isJsonExpanded && hasExtra && (
                <div className="log-details"><pre>{formattedJson}</pre></div>
            )}
        </div>
    );
};

const LOG_LEVELS: utils.Log['level'][] = ['ERROR', 'WARN', 'INFO', 'DEBUG'];

const LogsView: React.FC<{ logs: utils.Deque<utils.Log> }> = ({ logs }) => {
    const { sendRequest } = useStateContext();
    const [filters, setFilters] = useState<Record<utils.Log['level'], boolean>>({
        ERROR: true, WARN: true, INFO: true, DEBUG: false
    });
    
    // State for individual toggle states
    const [expandedTraces, setExpandedTraces] = useState<Set<number>>(new Set());
    const [expandedJson, setExpandedJson] = useState<Set<number>>(new Set());

    // State for the "master" toggles
    const [expandAllJson, setExpandAllJson] = useState(false);
    const [expandAllTraces, setExpandAllTraces] = useState(false);

    const logContainerRef = useRef<HTMLDivElement>(null);
    const isAtBottomRef = useRef(true);

    // Initial log fetch and setup
    useEffect(() => {
        if (logs.is_empty()) {
            sendRequest({ type: 'get_logs', payload: {} });
        } else {
            // Pre-expand errors on first load
            const errorIndices = new Set<number>();
            logs.map((log, i) => {
                if (log.level === 'ERROR') errorIndices.add(i);
            });
            setExpandedTraces(prev => new Set([...prev, ...errorIndices]));
        }
    }, []); // Runs only on initial mount

    // Memoize the logs with their original indices
    const allLogs = useMemo(() => logs.map((l, i) => ({ log: l, originalIndex: i })), [logs.size]);
    
    // Memoize the filtered list
    const filteredLogs = useMemo(() => {
        return allLogs.filter(item => filters[item.log.level]);
    }, [allLogs, filters]);

    // This is the core logic for sticky scrolling.
    // It runs AFTER the DOM has been updated with new logs.
    useLayoutEffect(() => {
        const el = logContainerRef.current;
        if (el && isAtBottomRef.current) {
            // If we were at the bottom before the update, scroll to the new bottom.
            el.scrollTop = el.scrollHeight;
        }
    }, [filteredLogs]); // Only run when the visible logs change

    // This handler continuously updates our ref with the current scroll state.
    const handleScroll = () => {
        const el = logContainerRef.current;
        if (el) {
            const isAtBottom = el.scrollHeight - el.scrollTop < el.clientHeight + 5; // 5px buffer
            isAtBottomRef.current = isAtBottom;
        }
    };

    // Handler for the "Expand All" checkboxes
    const handleExpandAll = (
        isChecked: boolean,
        setExpandedState: React.Dispatch<React.SetStateAction<Set<number>>>
    ) => {
        const filteredIndices = new Set(filteredLogs.map(item => item.originalIndex));
        
        setExpandedState(prev => {
            const next = new Set(prev);
            if (isChecked) {
                // Add all visible items to the set
                filteredIndices.forEach(i => next.add(i));
            } else {
                // Remove all visible items from the set
                filteredIndices.forEach(i => next.delete(i));
            }
            return next;
        });
    };

    const handleFilterChange = (level: utils.Log['level']) => {
        setFilters(f => ({ ...f, [level]: !f[level] }));
    };

    const toggleTrace = (index: number) => {
        setExpandedTraces(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index); else next.add(index);
            return next;
        });
    };

    const toggleJson = (index: number) => {
        setExpandedJson(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index); else next.add(index);
            return next;
        });
    };
    
    const scrollToTop = () => {
        if (logContainerRef.current) logContainerRef.current.scrollTop = 0;
    };

    const scrollToBottom = () => {
        if (logContainerRef.current) {
             logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
             isAtBottomRef.current = true; // Force state update
        }
    };

    return (
        <div className="logs-view-container">
            <div className="logs-controls">
                <div className="control-group">
                    <label>Filter Levels:</label>
                    {LOG_LEVELS.map(level => (
                        <label key={level}>
                            <input type="checkbox" checked={filters[level]} onChange={() => handleFilterChange(level)} />
                            {level}
                        </label>
                    ))}
                </div>
                 <div className="control-group">
                    <label htmlFor="expandAllTraces">Expand all traces</label>
                    <input type="checkbox" id="expandAllTraces" checked={expandAllTraces} onChange={(e) => {
                        setExpandAllTraces(e.target.checked);
                        handleExpandAll(e.target.checked, setExpandedTraces);
                    }} />
                </div>
                <div className="control-group">
                    <label htmlFor="expandAllJson">Expand all JSON</label>
                    <input type="checkbox" id="expandAllJson" checked={expandAllJson} onChange={(e) => {
                        setExpandAllJson(e.target.checked);
                        handleExpandAll(e.target.checked, setExpandedJson);
                    }} />
                </div>
                <button className="scroll-btn" title="Scroll to top" onClick={scrollToTop} dangerouslySetInnerHTML={{ __html: svg.icon_up }} ></button>
                <button className="scroll-btn" title="Scroll to bottom" onClick={scrollToBottom} dangerouslySetInnerHTML={{ __html: svg.icon_down }} ></button>
            </div>
            <div className="logs-list" ref={logContainerRef} onScroll={handleScroll}>
                {filteredLogs.length === 0 ? (
                    <div className="no-logs">No logs available or matching filters.</div>
                ) : (
                    filteredLogs.map(item => (
                         <LogEntry
                            key={item.originalIndex}
                            log={item.log}
                            isTraceExpanded={expandedTraces.has(item.originalIndex)}
                            isJsonExpanded={expandedJson.has(item.originalIndex)}
                            onToggleTrace={() => toggleTrace(item.originalIndex)}
                            onToggleJson={() => toggleJson(item.originalIndex)}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

const OverviewView: React.FC = () => {
    const { state } = useStateContext();

    if (!state) {
        return <div>Loading state...</div>;
    }

    const windowNodes = (Array.from(state.nodes.values())
        .filter(n => n.type === 'window') as WindowData[])
        .sort((a, b) => {
            if (a.closed !== b.closed) return a.closed ? 1 : -1;
            if (a.name.is_custom !== b.name.is_custom) return a.name.is_custom ? -1 : 1;
            return a.name.generation - b.name.generation;
        });

    return (
        <div id="overview-container">
            {windowNodes.map(node => (
                <div key={node.bid} className="window-view" data-state-id={node.bid.toString()}>
                    <TabTreeView treeType="overview" mode="live" rootId={node.bid} />
                </div>
            ))}
        </div>
    );
};


const SettingsPage: React.FC = () => {
    const { port, sendAction } = useStateContext();
    const [currentView, setCurrentView] = useState<'settings' | 'snapshots' | 'logs' | 'overview'>('settings');
    const [currentWindowId, setCurrentWindowId] = useState<WindowId | undefined>();
    const [logs, setLogs] = useState<utils.Deque<utils.Log>>(new utils.Deque(10000));

    useEffect(() => {
        browser.windows.getCurrent().then(win => {
            setCurrentWindowId(win.id as WindowId);
        });
    }, []);

    useEffect(() => {
        if (!port) return;

        const handleMessage = (message: BruhUiEvent) => {
            if (message.type === 'app_response' && message.payload.type === 'converted_sideberry_export_ready') {
                sendAction({ type: 'load_bruh_export', payload: { data: message.payload.payload.data } });
                alert('Sideberry data imported successfully! Your imported windows have been added as closed windows.');
            } else if (message.type === 'logs') {
                 setLogs(prev => {
                    const newLogs = new utils.Deque<utils.Log>();
                    // clone deque
                    prev.map(l => newLogs.push_back(l));
                    
                    message.payload.logs.forEach(log => {
                        newLogs.push_back(log);
                        if(newLogs.size > 10000) {
                            newLogs.pop_front();
                        }
                    });
                    return newLogs;
                });
            }
        };
        port.onMessage.addListener(handleMessage);
        return () => { port.onMessage.removeListener(handleMessage) };
    }, [port, sendAction]);

    const renderContent = () => {
        switch (currentView) {
            case 'settings':
                return <SettingsView />;
            case 'snapshots':
                return <SnapshotsView currentWindowId={currentWindowId} />;
            case 'logs':
                return <LogsView logs={logs}/>;
            case 'overview':
                return <OverviewView />;
            default:
                return null;
        }
    };

    return (
        <div style={{ display: 'flex', height: '100vh' }}>
            <div className="sidebar">
                <button
                    className={`sidebar-button ${currentView === 'overview' ? 'active' : ''}`}
                    onClick={() => setCurrentView('overview')}
                >
                    Overview
                </button>
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
                <button
                    className={`sidebar-button ${currentView === 'logs' ? 'active' : ''}`}
                    onClick={() => setCurrentView('logs')}
                >
                    Logs
                </button>
            </div>
            <div id="content" className={`content ${currentView === 'overview' ? 'no-padding' : ''}`}>
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
