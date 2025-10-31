// overview.tsx
import './overview.css';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import browser from 'webextension-polyfill';
import { TabTreeView } from './components/TabTreeView';
import { StateProvider, useStateContext } from './components/StateProvider';
import type { BruhId, WindowData, AppRequest, BruhExport, SideberryExport, BruhUiEvent, ExtensionAction, StateAction } from './types';

const OverviewContent: React.FC = () => {
    const { state, sendRequest, sendAction } = useStateContext();
    const [viewMode, setViewMode] = useState<'overview' | 'group'>('overview');
    const [groupViewNodeId, setGroupViewNodeId] = useState<BruhId | undefined>();
    const [action, setAction] = useState<string | null>(null);

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const view = urlParams.get('view');
        const nodeId = urlParams.get('id');
        const groupName = urlParams.get('name');
        const actionParam = urlParams.get('action');

        if (actionParam) {
            setAction(actionParam);
            document.title = `Tabruh - ${actionParam.charAt(0).toUpperCase() + actionParam.slice(1)}`;
            if (actionParam === 'import') {
                handleImport();
            }
        } else if (view === 'group' && nodeId) {
            setViewMode('group');
            setGroupViewNodeId(parseInt(nodeId, 10) as BruhId);
            document.querySelector('#overview-container')?.classList.add('group-view-mode');
            document.title = groupName ?? 'Tabruh Group';
        } else {
            setViewMode('overview');
            document.title = 'Tabruh Overview';
        }
    }, []);

    const handleImport = () => {
        const port = browser.runtime.connect({ name: 'overview-importer' });
        port.onMessage.addListener((message: BruhUiEvent) => {
            if (message.type === 'app_response' && message.payload.type === 'converted_sideberry_export_ready') {
                const importAction: StateAction = { type: 'load_bruh_export', payload: { data: message.payload.payload.data } };
                const msg: ExtensionAction = { type: 'state_action', payload: importAction };
                port.postMessage(msg);
                alert('Sideberry data imported successfully! Your imported windows have been added as closed windows.');
                window.close();
            }
        });

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

                        if ('id' in data) {
                            const req: AppRequest = { type: 'convert_sideberry_export', payload: { data: data as SideberryExport } };
                            const msg: ExtensionAction = { type: 'app_request', payload: req };
                            port.postMessage(msg);
                        } else if ('timestamp' in data) {
                            const importAction: StateAction = { type: 'load_bruh_export', payload: { data: data as BruhExport } };
                            const msg: ExtensionAction = { type: 'state_action', payload: importAction };
                            port.postMessage(msg);
                            alert('Import successful! Your imported windows have been added as closed windows.');
                            window.close();
                        } else {
                            alert('Unrecognized export format.'); window.close();
                        }
                    } catch (err) {
                        console.error('Error importing file:', err);
                        alert('Failed to read or parse the import file.'); window.close();
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
                if (!input.files || input.files.length === 0) window.close();
            }, 500);
        };
        window.addEventListener('focus', onFocus, { once: true });

        document.body.appendChild(input);
        input.click();
        document.body.removeChild(input);
    };

    if (action === 'import') {
        return (
            <div className="action-page-container">
                <h1 className="action-page-title">Import State</h1>
                <p className="action-page-description">Select a Tabruh or Sideberry export file (.json) to import.</p>
                <button id="select-file-button" className="action-page-button" onClick={handleImport}>Select File</button>
            </div>
        );
    }

    if (!state) {
        return <div>Loading state...</div>;
    }

    if (viewMode === 'group' && groupViewNodeId) {
        const groupNode = state.nodes.get(groupViewNodeId);
        if (groupNode) {
            return (
                <div className="window-view" data-state-id={groupNode.bid.toString()}>
                    <TabTreeView treeType="overview" mode="live" rootId={groupNode.bid} />
                </div>
            );
        }
        return <div>Group not found.</div>
    }

    const windowNodes = (Array.from(state.nodes.values())
        .filter(n => n.type === 'window') as WindowData[])
        .sort((a, b) => {
            if (a.closed !== b.closed) return a.closed ? 1 : -1;
            if (a.name.is_custom !== b.name.is_custom) return a.name.is_custom ? -1 : 1;
            return a.name.generation - b.name.generation;
        });

    return (
        <>
            {windowNodes.map(node => (
                <div key={node.bid} className="window-view" data-state-id={node.bid.toString()}>
                    <TabTreeView treeType="overview" mode="live" rootId={node.bid} />
                </div>
            ))}
        </>
    );
};

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('overview-container');
    if (!container) return;

    const root = ReactDOM.createRoot(container);
    root.render(
        <React.StrictMode>
            <StateProvider connectionName="overview-connection">
                <OverviewContent />
            </StateProvider>
        </React.StrictMode>
    );
});
