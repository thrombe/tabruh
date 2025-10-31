import React, { memo, useCallback, useMemo } from 'react';
import type { BruhExport, SnapshotDragData } from '../types';
import * as svg from '../svg';
import { useStateContext } from './StateProvider';

const DEFAULT_FAVICON_URL = `data:image/svg+xml;base64,${btoa(svg.default_favicon)}`;

type SnapshotTreeNodeProps = {
    tabIndex: number;
    snapshotWindow: BruhExport['windows'][number];
    snapshotId: string;
    windowIndex: number;
    childrenMap: Map<number | null, number[]>;
    showContextMenu: (x: number, y: number, tabIndex: number) => void;
};

const is_group_tab_snapshot = (url: string | undefined): boolean => {
    if (!url) return false;
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.protocol === 'moz-extension:' &&
            parsedUrl.pathname.endsWith('/overview.html') &&
            parsedUrl.searchParams.get('view') === 'group';
    } catch (e) {
        return false;
    }
};

const countDescendants = (rootIndex: number, map: Map<number | null, number[]>): number => {
    let count = 0;
    const queue = [...(map.get(rootIndex) || [])];
    while (queue.length > 0) {
        const currentIndex = queue.shift()!;
        count++;
        const children = map.get(currentIndex);
        if (children) {
            queue.push(...children);
        }
    }
    return count;
};

const SnapshotTreeNode: React.FC<SnapshotTreeNodeProps> = ({ tabIndex, snapshotWindow, snapshotId, windowIndex, childrenMap, showContextMenu }) => {
    const { sendAction } = useStateContext();
    const tab = snapshotWindow.tabs[tabIndex]!;
    const children = useMemo(() => childrenMap.get(tabIndex) || [], [childrenMap, tabIndex]);
    const isGroup = is_group_tab_snapshot(tab.url);

    const handleToggleCollapse = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        sendAction({
            type: 'toggle_snapshot_collapse',
            payload: { snapshot_id: snapshotId, window_index: windowIndex, tab_index: tabIndex }
        });
    }, [sendAction, snapshotId, windowIndex, tabIndex]);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, tabIndex);
    }, [showContextMenu, tabIndex]);

    const handleDragStart = useCallback((event: React.DragEvent) => {
        event.stopPropagation();
        const dragData: SnapshotDragData = {
            type: 'snapshot_item',
            snapshotId,
            windowIndex,
            tabIndex,
        };
        event.dataTransfer.setData('application/json', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'move';
        setTimeout(() => (event.target as HTMLElement).classList.add('dragging'), 0);
    }, [snapshotId, windowIndex, tabIndex]);

    const handleDragEnd = useCallback((event: React.DragEvent) => {
        (event.target as HTMLElement).classList.remove('dragging');
    }, []);

    const classNames = ['tree-node'];
    if (isGroup) classNames.push('group-node');
    const descendantCount = tab.collapsed ? countDescendants(tabIndex, childrenMap) : 0;

    return (
        <div data-node-id={String(tabIndex)}>
            <div
                className={classNames.join(' ')}
                draggable
                onContextMenu={handleContextMenu}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <div className="collapse-container">
                    {children.length > 0 && (
                        <button
                            className={`collapse-button ${tab.collapsed ? 'collapsed' : ''}`}
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
                        src={isGroup ? `data:image/svg+xml;base64,${btoa(svg.icon_group)}` : DEFAULT_FAVICON_URL}
                    />
                    <span className="tree-node-title">{tab.title}</span>
                </div>
                <button
                    className="close-tab-button"
                    onClick={(e) => {
                        e.stopPropagation();
                        showContextMenu(e.clientX, e.clientY, tabIndex);
                    }}
                >
                    &#x22EE;
                </button>
            </div>
            {!tab.collapsed && children.length > 0 && (
                <div className="children-container">
                    {children.map(childIndex => (
                        <SnapshotTreeNode
                            key={childIndex}
                            tabIndex={childIndex}
                            snapshotWindow={snapshotWindow}
                            snapshotId={snapshotId}
                            windowIndex={windowIndex}
                            childrenMap={childrenMap}
                            showContextMenu={showContextMenu}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default memo(SnapshotTreeNode);
