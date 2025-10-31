// components/SnapshotTreeHeader.tsx
import React, { useCallback } from 'react';
import type { BruhExport, SnapshotDragData } from '../types';
import { useStateContext } from './StateProvider';

type SnapshotTreeHeaderProps = {
    snapshotWindow: BruhExport['windows'][number];
    snapshotId: string;
    windowIndex: number;
    showGroupContextMenu: (x: number, y: number, windowIndex: number, isClosed: boolean) => void;
};

export const SnapshotTreeHeader: React.FC<SnapshotTreeHeaderProps> = ({ snapshotWindow, snapshotId, windowIndex, showGroupContextMenu }) => {
    const { sendAction } = useStateContext();

    const handleToggleCollapse = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        sendAction({ type: 'toggle_snapshot_window_collapse', payload: { snapshot_id: snapshotId, window_index: windowIndex } });
    }, [sendAction, snapshotId, windowIndex]);

    const handleDragStart = useCallback((event: React.DragEvent) => {
        event.stopPropagation();
        const dragData: SnapshotDragData = {
            type: 'snapshot_item',
            snapshotId,
            windowIndex,
            tabIndex: undefined,
        };
        event.dataTransfer.setData('application/json', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'move';
        setTimeout(() => event.currentTarget.parentElement?.classList.add('dragging'), 0);
    }, [snapshotId, windowIndex]);

    const handleDragEnd = useCallback((event: React.DragEvent) => {
        event.currentTarget.parentElement?.classList.remove('dragging');
    }, []);

    return (
        <div className="tab-tree-header" draggable onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <button
                className={`group-menu-button header-collapse-button ${snapshotWindow.collapsed ? 'collapsed' : ''}`}
                onClick={handleToggleCollapse}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="arrow-svg"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <span className="group-name">{snapshotWindow.name ?? "Unnamed Window"}</span>
            <button
                className="group-menu-button"
                onClick={(e) => {
                    e.stopPropagation();
                    showGroupContextMenu(e.clientX, e.clientY, windowIndex, false);
                }}
            >
                &#x22EE;
            </button>
        </div>
    );
};
