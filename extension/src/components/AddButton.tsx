// components/AddButton.tsx
import React, { useCallback, useState } from 'react';
import type { BruhId, DragData, DropAction, SnapshotDragData } from '../types';
import { useStateContext } from './StateProvider';

type AddButtonProps = {
    rootId: BruhId;
};

const getUrlFromDataTransfer = (dataTransfer: DataTransfer): string | null => {
    const url = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain');
    return url ? url.trim() : null;
};

export const AddButton: React.FC<AddButtonProps> = ({ rootId }) => {
    const { sendAction } = useStateContext();
    const [isDragOver, setIsDragOver] = useState(false);

    const handleClick = useCallback(() => {
        sendAction({
            type: 'create_tab',
            payload: { parent_bid: rootId, action: 'inside' }
        });
    }, [sendAction, rootId]);

    const handleDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        const types = event.dataTransfer?.types;
        if (types && (types.includes('application/json') || types.includes('text/uri-list') || types.includes('text/plain'))) {
            event.dataTransfer.dropEffect = 'move';
            setIsDragOver(true);
        }
    }, []);

    const handleDragLeave = useCallback(() => {
        setIsDragOver(false);
    }, []);

    const handleDrop = useCallback(async (event: React.DragEvent) => {
        event.preventDefault();
        setIsDragOver(false);
        const dataTransfer = event.dataTransfer;
        if (!dataTransfer) return;

        const types = dataTransfer.types;
        const action: DropAction = 'inside';

        if (types.includes('application/json')) {
            const dragDataStr = dataTransfer.getData('application/json');
            if (!dragDataStr) return;
            const dragData: DragData = JSON.parse(dragDataStr);

            if (dragData.type === 'snapshot_item') {
                sendAction({
                    type: 'handle_snapshot_drop',
                    payload: { drag_data: dragData, target_bid: rootId, action },
                });
            } else {
                sendAction({
                    type: 'handle_drop',
                    payload: { drag_data: dragData, target_bid: rootId, action },
                });
            }
        } else if (types.includes('text/uri-list') || types.includes('text/plain')) {
            const url = getUrlFromDataTransfer(dataTransfer);
            if (url) {
                sendAction({ type: 'create_tab', payload: { url, parent_bid: rootId, action } });
            }
        }
    }, [rootId, sendAction]);

    const className = `add-tab-button ${isDragOver ? 'drag-over-target' : ''}`;

    return (
        <div
            className={className}
            onClick={handleClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            +
        </div>
    );
};
