// sidebar.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import browser from 'webextension-polyfill';
import { TabTreeView } from './components/TabTreeView';
import { StateProvider, useStateContext } from './components/StateProvider';
import type { WindowId } from './types';

const App: React.FC<{ windowId: WindowId }> = ({ windowId }) => {
    const { state } = useStateContext();
    const wbid = state?.window_bids.get(windowId);

    if (!wbid) {
        return null;
    }

    return <TabTreeView treeType="sidebar" mode="live" rootId={wbid} currentWindowId={windowId} />;
};


const main = async () => {
    const container = document.getElementById('tree-container');
    if (!container) return;

    const win = await browser.windows.getCurrent();
    const windowId = win.id as WindowId;

    const root = ReactDOM.createRoot(container);
    root.render(
        <React.StrictMode>
            <StateProvider connectionName="sidebar-connection">
                <App windowId={windowId} />
            </StateProvider>
        </React.StrictMode>
    );
};

document.addEventListener('DOMContentLoaded', main);
