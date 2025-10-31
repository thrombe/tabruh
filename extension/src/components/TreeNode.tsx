// components/TreeNode.tsx
import React, { memo, useState, useCallback } from 'react';
import type { BruhId, DropAction, DragData } from '../types';
import * as svg from '../svg';
import { useStateContext } from './StateProvider';

const DEFAULT_FAVICON_URL = `data:image/svg+xml;base64,${btoa(svg.default_favicon)}`;

type TreeNodeProps = {
    nodeId: BruhId;
    showContextMenu: (x: number, y: number, nodeId: BruhId) => void;
};

const getUrlFromDataTransfer = (dataTransfer: DataTransfer): string | null => {
    const url = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain');
    return url ? url.trim() : null;
};

const TreeNode: React.FC<TreeNodeProps> = ({ nodeId, showContextMenu }) => {
    const { state, sendAction } = useStateContext();
    const [dragOverAction, setDragOverAction] = useState<DropAction | null>(null);

    const node = state?.get_node(nodeId);
    if (!state || !node) return null;

    const children = state.get_immediate_children(nodeId);
    const window = state.get_window(node.wbid);
    const isClosed = state.is_node_closed(nodeId);

    const handleFocus = useCallback(() => {
        if (!isClosed) {
            sendAction({ type: 'focus_tab', payload: { bid: nodeId } });
        }
    }, [sendAction, nodeId, isClosed]);

    const handleMouseDown = useCallback((event: React.MouseEvent) => {
        if (event.button === 1) {
            event.preventDefault();
            sendAction({ type: 'close_tabs', payload: { bid: nodeId, recursive: false } });
        }
    }, [sendAction, nodeId]);

    const handleToggleCollapse = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        sendAction({ type: 'toggle_collapse', payload: { bid: nodeId } });
    }, [sendAction, nodeId]);

    const handleClose = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        sendAction({ type: 'close_tabs', payload: { bid: nodeId, recursive: false } });
    }, [sendAction, nodeId]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, nodeId);
    }, [showContextMenu, nodeId]);

    const handleDragStart = useCallback((event: React.DragEvent) => {
        event.stopPropagation();
        const movedNodeIds = state.get_subtree(nodeId);
        const dragData: DragData = {
            type: 'tabs',
            draggedNodeId: nodeId,
            sourceWindowId: node.wbid,
            movedNodeIds,
        };
        event.dataTransfer.setData('application/json', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'move';
        setTimeout(() => (event.target as HTMLElement).classList.add('dragging'), 0);
    }, [state, nodeId, node.wbid]);

    const handleDragEnd = useCallback((event: React.DragEvent) => {
        (event.target as HTMLElement).classList.remove('dragging');
        if (event.dataTransfer.dropEffect === 'none') {
            sendAction({ type: 'move_subtree_to_new_window', payload: { bid: nodeId } });
        }
    }, [sendAction, nodeId]);

    const handleDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        const types = event.dataTransfer.types;
        if (!types || !(types.includes('application/json') || types.includes('text/uri-list') || types.includes('text/plain'))) {
            return;
        }

        if (types.includes('application/json')) {
            const dragDataStr = event.dataTransfer.getData('application/json');
            if (dragDataStr) {
                const dragData: DragData = JSON.parse(dragDataStr);
                if (dragData.type === 'tabs' && dragData.movedNodeIds.includes(nodeId)) {
                    setDragOverAction(null);
                    return;
                }
            }
        }

        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const y = event.clientY - rect.top;
        let action: DropAction;
        if (y < rect.height * 0.25) action = 'above';
        else if (y > rect.height * 0.75) action = 'below';
        else action = 'inside';

        setDragOverAction(action);
        event.dataTransfer.dropEffect = 'move';
    }, [nodeId]);

    const handleDragLeave = useCallback(() => {
        setDragOverAction(null);
    }, []);

    const handleDrop = useCallback(async (event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const action = dragOverAction;
        setDragOverAction(null);
        if (!action) return;

        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) return;

        const types = dataTransfer.types;
        if (types.includes('application/json')) {
            const dragDataStr = dataTransfer.getData('application/json');
            if (!dragDataStr) return;
            const dragData: DragData = JSON.parse(dragDataStr);

            if (dragData.type === 'snapshot_item') {
                sendAction({ type: 'handle_snapshot_drop', payload: { drag_data: dragData, target_bid: nodeId, action } });
            } else if (dragData.type === 'tabs' || dragData.type === 'window') {
                const movedNodeIds = state.get_subtree(dragData.draggedNodeId);
                if (!movedNodeIds.includes(nodeId)) {
                    sendAction({ type: 'handle_drop', payload: { drag_data: dragData, target_bid: nodeId, action } });
                }
            }
        } else if (types.includes('text/uri-list') || types.includes('text/plain')) {
            const url = getUrlFromDataTransfer(dataTransfer);
            if (url) {
                sendAction({ type: 'create_tab', payload: { url, parent_bid: nodeId, action } });
            }
        }
    }, [sendAction, state, nodeId, dragOverAction]);

    const classNames = ['tree-node'];
    if (node.type === 'group') classNames.push('group-node');
    if ((node.type !== 'window' && node.discarded) || isClosed) classNames.push('discarded-tab');
    if (window.active === node.bid) classNames.push('focused-tab');
    if (dragOverAction) classNames.push(`drag-over-${dragOverAction}`);

    const descendantCount = node.collapsed ? state.get_subtree(nodeId).length - 1 : 0;

    return (
        <div data-node-id={String(node.bid)}>
            <div
                className={classNames.join(' ')}
                draggable={true}
                onClick={handleFocus}
                onMouseDown={handleMouseDown}
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                <div className="collapse-container">
                    {children.length > 0 && (
                        <button
                            className={`collapse-button ${node.collapsed ? 'collapsed' : ''}`}
                            onClick={handleToggleCollapse}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="arrow-svg"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            {descendantCount > 0 && <span className="collapsed-count">{descendantCount}</span>}
                        </button>
                    )}
                </div>
                <div className="tree-node-content">
                    <img
                        className="tree-node-icon"
                        src={
                            node.type === 'group' ? `data:image/svg+xml;base64,${btoa(svg.icon_group)}`
                                : (node.fav_icon_url || DEFAULT_FAVICON_URL)
                        }
                        onError={(e) => {
                            if ((e.target as HTMLImageElement).src !== DEFAULT_FAVICON_URL) {
                                (e.target as HTMLImageElement).src = DEFAULT_FAVICON_URL;
                            }
                        }}
                    />
                    <span className="tree-node-title">{state.get_node_name(nodeId)}</span>
                </div>
                <button className="close-tab-button" onClick={handleClose} dangerouslySetInnerHTML={{ __html: svg.icon_close }} />
            </div>

            {!node.collapsed && children.length > 0 && (
                <div className="children-container">
                    {children.map(childId => (
                        <TreeNode key={childId} nodeId={childId} showContextMenu={showContextMenu} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default memo(TreeNode);
