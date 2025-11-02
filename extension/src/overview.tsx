import './overview.css';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { TabTreeView } from './components/TabTreeView';
import { StateProvider, useStateContext } from './components/StateProvider';
import type { BruhId, WindowData } from './types';

const OverviewContent: React.FC = () => {
    const { state } = useStateContext();
    const [viewMode, setViewMode] = useState<'overview' | 'group'>('overview');
    const [groupViewNodeId, setGroupViewNodeId] = useState<BruhId | undefined>();

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const view = urlParams.get('view');
        const nodeId = urlParams.get('id');
        const groupName = urlParams.get('name');
        
        if (view === 'group' && nodeId) {
            setViewMode('group');
            setGroupViewNodeId(parseInt(nodeId, 10) as BruhId);
            document.querySelector('#overview-container')?.classList.add('group-view-mode');
            document.title = groupName ?? 'Tabruh Group';
        } else {
            setViewMode('overview');
            document.title = 'Tabruh Overview';
        }
    }, []);

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
