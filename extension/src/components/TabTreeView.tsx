// components/TabTreeView.tsx
import './tab_tree_view.css';
import React, { useCallback, useMemo } from 'react';
import browser from 'webextension-polyfill';
import * as svg from '../svg';
import type { BruhId, WindowId, BruhExport, SnapshotDragData, Node } from '../types';
import { useStateContext } from './StateProvider';
import { useContextMenu, ContextMenuPortal } from '../hooks/useContextMenu';
import { TreeHeader } from './TreeHeader';
import TreeNode from './TreeNode';
import { AddButton } from './AddButton';
import { SnapshotTreeHeader } from './SnapshotTreeHeader';
import SnapshotTreeNode from './SnapshotTreeNode';

type TreeViewProps = {
    treeType: 'sidebar' | 'overview' | 'snapshot';
    currentWindowId?: WindowId;
} & ({
    mode: 'live';
    rootId: BruhId;
} | {
    mode: 'snapshot';
    snapshotWindow: BruhExport['windows'][number];
    snapshotId: string;
    windowIndex: number;
});

const getUrlFromNode = (state: any, nodeId: BruhId): string | undefined => state?.get_node_url(nodeId);

export const TabTreeView: React.FC<TreeViewProps> = (props) => {
    const { state, sendAction } = useStateContext();
    const { menuState, showMenu, hideMenu } = useContextMenu();

    const startNodeRename = useCallback((nodeId: BruhId) => {
        // This functionality has been moved into the TreeHeader component itself
        // But for nodes, we need a different approach, maybe a global state for renaming target
        console.log("Renaming needs to be re-implemented for nodes with a global state or similar pattern.");
    }, []);

    const copyUrl = useCallback(async (nodeIdentifier: BruhId | number) => {
        let url: string | undefined;
        if (props.mode === 'snapshot') {
            const tab = props.snapshotWindow.tabs[nodeIdentifier as number];
            url = tab?.url;
        } else if (state) {
            url = getUrlFromNode(state, nodeIdentifier as BruhId);
        }

        if (url) {
            try {
                await navigator.clipboard.writeText(url);
            } catch (e) {
                console.error('Failed to copy URL:', e);
            }
        }
    }, [state, props]);

    const showGroupContextMenu = useCallback((x: number, y: number, identifier: BruhId | number, isClosed: boolean) => {
        const createItem = (label: string, icon: string, action: () => void, disabled = false) => (
            <div className={`context-menu-item ${disabled ? 'disabled' : ''}`} onClick={!disabled ? () => { action(); hideMenu(); } : undefined}>
                <span className="context-menu-icon" dangerouslySetInnerHTML={{ __html: icon }} />
                <span>{label}</span>
            </div>
        );

        const createSeparator = () => <div className="context-menu-separator" />;

        let content;
        if (props.treeType === 'snapshot' && props.mode === 'snapshot') {
            const { snapshotId } = props;
            const windowIndex = identifier as number;
            content = (
                <>
                    {createItem('Restore as New Window', svg.icon_restore, () => sendAction({ type: 'restore_snapshot_window', payload: { id: snapshotId, window_index: windowIndex } }))}
                    {createItem('Restore to Current Window', svg.icon_restore, () => {
                        if (props.currentWindowId) {
                            const dragData: SnapshotDragData = { type: 'snapshot_item', snapshotId: snapshotId, windowIndex: windowIndex };
                            sendAction({
                                type: 'handle_snapshot_drop',
                                payload: { drag_data: dragData, target_bid: 0 as BruhId, action: 'inside', target_wid: props.currentWindowId }
                            });
                        }
                    }, !props.currentWindowId)}
                </>
            );
        } else if (isClosed) {
            const wbid = identifier as BruhId;
            content = (
                <>
                    {createItem('Restore Window', svg.icon_restore, () => sendAction({ type: 'restore_window', payload: { wbid } }))}
                    {createSeparator()}
                    {createItem('Delete State', svg.icon_trash, () => sendAction({ type: 'delete_window_state', payload: { wbid } }))}
                </>
            );
        } else {
            const bid = identifier as BruhId;
            content = (
                <>
                    {createItem('New Group', svg.icon_group, () => sendAction({ type: 'create_group', payload: { parent_bid: bid } }))}
                    {createSeparator()}
                    {createItem('Close Window', svg.icon_close, () => sendAction({ type: 'close_window', payload: { wbid: bid } }))}
                </>
            );
        }
        showMenu(x, y, content);
    }, [props, sendAction, hideMenu, showMenu]);

    const showNodeContextMenu = useCallback((x: number, y: number, nodeIdentifier: BruhId | number) => {
        const createItem = (label: string, icon: string, action: () => void, disabled = false) => (
            <div className={`context-menu-item ${disabled ? 'disabled' : ''}`} onClick={!disabled ? () => { action(); hideMenu(); } : undefined}>
                <span className="context-menu-icon" dangerouslySetInnerHTML={{ __html: icon }} />
                <span>{label}</span>
            </div>
        );

        const createSeparator = () => <div className="context-menu-separator" />;

        let content;
        if (props.treeType === 'snapshot' && props.mode === 'snapshot') {
            const { snapshotId, windowIndex } = props;
            const tabIndex = nodeIdentifier as number;
            content = (
                <>
                    {createItem('Restore as New Window', svg.icon_restore, () => sendAction({ type: 'restore_snapshot_subtree', payload: { id: snapshotId, window_index: windowIndex, tab_index: tabIndex } }))}
                    {createItem('Restore to Current Window', svg.icon_restore, () => {
                        if (props.currentWindowId) {
                            const dragData: SnapshotDragData = { type: 'snapshot_item', snapshotId, windowIndex, tabIndex };
                            sendAction({
                                type: 'handle_snapshot_drop',
                                payload: { drag_data: dragData, target_bid: 0 as BruhId, action: 'inside', target_wid: props.currentWindowId }
                            });
                        }
                    }, !props.currentWindowId)}
                    {createSeparator()}
                    {createItem('Copy URL', svg.icon_copy, () => copyUrl(nodeIdentifier))}
                </>
            );
        } else if (state && props.mode === 'live') {
            const nodeId = nodeIdentifier as BruhId;
            const node = state.get_node(nodeId);
            if (!node) return;
            const isNodeClosed = state.is_node_closed(nodeId);
            const children = state.get_immediate_children(nodeId);

            content = (
                <>
                    {node.type === 'group' && createItem('Rename Group', svg.icon_edit, () => startNodeRename(nodeId))}
                    {node.type === 'group' && createSeparator()}
                    {createItem('New Group Here', svg.icon_group, () => sendAction({ type: 'create_group', payload: { parent_bid: nodeId } }))}
                    {createItem('Duplicate Tab', svg.icon_duplicate, () => sendAction({ type: 'duplicate_tab', payload: { bid: nodeId } }))}
                    {createSeparator()}
                    {!isNodeClosed && (
                        <>
                            {createItem('Load Tree', svg.icon_load, () => sendAction({ type: 'reload_tree', payload: { bid: nodeId } }))}
                            {createItem('Unload Tab', svg.icon_unload, () => sendAction({ type: 'unload_tabs', payload: { bid: nodeId, recursive: false } }))}
                            {children.length > 0 && createItem('Unload Tree', svg.icon_unload, () => sendAction({ type: 'unload_tabs', payload: { bid: nodeId, recursive: true } }))}
                            {createSeparator()}
                        </>
                    )}
                    {createItem('Close Tab Only', svg.icon_close, () => sendAction({ type: 'close_tabs', payload: { bid: nodeId, recursive: false } }))}
                    {children.length > 0 && createItem('Close Tree', svg.icon_tree, () => sendAction({ type: 'close_tabs', payload: { bid: nodeId, recursive: true } }))}
                    {createItem('Move to New Window', svg.icon_window, () => sendAction({ type: 'move_subtree_to_new_window', payload: { bid: nodeId } }))}
                    {createSeparator()}
                    {children.length > 0 && (
                        <>
                            {createItem('Flatten Immediate Children', svg.icon_flatten_immediate, () => sendAction({ type: 'flatten_tree', payload: { bid: nodeId, recursive: false } }))}
                            {createItem('Flatten Tree', svg.icon_flatten_tree, () => sendAction({ type: 'flatten_tree', payload: { bid: nodeId, recursive: true } }))}
                            {createSeparator()}
                        </>
                    )}
                    {createItem('Copy URL', svg.icon_copy, () => copyUrl(nodeIdentifier))}
                </>
            );
        }
        showMenu(x, y, content);
    }, [props, sendAction, state, hideMenu, showMenu, copyUrl, startNodeRename]);

    if (!state && props.mode === 'live') {
        return <div className="tab-tree-view-container">Loading...</div>;
    }

    if (props.mode === 'live') {
        const rootNode = state!.get_node(props.rootId);
        if (!rootNode) return null;

        const isClosed = state!.is_node_closed(props.rootId);
        const window = state!.get_window(rootNode.wbid);
        const children = state!.get_immediate_children(props.rootId);
        const containerClasses = `tab-tree-view-container ${isClosed && props.treeType !== 'snapshot' ? 'closed-group' : ''}`;

        return (
            <div className={containerClasses}>
                <TreeHeader rootNode={rootNode} isClosed={isClosed} showGroupContextMenu={showGroupContextMenu} />
                {(!rootNode.collapsed || props.treeType === 'sidebar') && (
                    <div className="tab-tree-scroll-container">
                        <div className="flex flex-col">
                            {children.map(childId => (
                                <TreeNode key={childId} nodeId={childId} showContextMenu={showNodeContextMenu} />
                            ))}
                        </div>
                        <AddButton rootId={props.rootId} />
                    </div>
                )}
                <ContextMenuPortal menuState={menuState} />
            </div>
        );
    }

    if (props.mode === 'snapshot') {
        const { snapshotWindow, snapshotId, windowIndex } = props;
        const childrenMap = useMemo(() => {
            const map = new Map<number | null, number[]>();
            snapshotWindow.tabs.forEach((tab, index) => {
                const parentIndex = tab.parent_index;
                if (!map.has(parentIndex)) map.set(parentIndex, []);
                map.get(parentIndex)!.push(index);
            });
            return map;
        }, [snapshotWindow.tabs]);

        const rootIndices = childrenMap.get(null) || [];

        return (
            <div className="tab-tree-view-container">
                <SnapshotTreeHeader snapshotWindow={snapshotWindow} snapshotId={snapshotId} windowIndex={windowIndex} showGroupContextMenu={showGroupContextMenu} />
                {!snapshotWindow.collapsed && (
                    <div className="tab-tree-scroll-container">
                        <div className="flex flex-col">
                            {rootIndices.map(tabIndex => (
                                <SnapshotTreeNode
                                    key={tabIndex}
                                    tabIndex={tabIndex}
                                    snapshotWindow={snapshotWindow}
                                    snapshotId={snapshotId}
                                    windowIndex={windowIndex}
                                    childrenMap={childrenMap}
                                    showContextMenu={showNodeContextMenu}
                                />
                            ))}
                        </div>
                    </div>
                )}
                <ContextMenuPortal menuState={menuState} />
            </div>
        );
    }

    return null;
};
