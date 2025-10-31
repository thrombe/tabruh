// components/TreeHeader.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Node, BruhId, DragData } from '../types';
import { useStateContext } from './StateProvider';

type TreeHeaderProps = {
    rootNode: Node;
    isClosed: boolean;
    showGroupContextMenu: (x: number, y: number, id: BruhId, isClosed: boolean) => void;
};

export const TreeHeader: React.FC<TreeHeaderProps> = ({ rootNode, isClosed, showGroupContextMenu }) => {
    const { state, sendAction } = useStateContext();
    const [isRenaming, setIsRenaming] = useState(false);
    const [name, setName] = useState(state?.get_node_name(rootNode.bid) ?? '');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setName(state?.get_node_name(rootNode.bid) ?? '');
    }, [state, rootNode.bid]);


    useEffect(() => {
        if (isRenaming && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isRenaming]);


    const handleRename = useCallback(() => {
        const nodeName = state?.get_node_name(rootNode.bid) ?? '';
        if (name.trim() && name.trim() !== nodeName) {
            sendAction({ type: 'rename_node', payload: { bid: rootNode.bid, new_name: name.trim() } });
        } else {
            setName(nodeName);
        }
        setIsRenaming(false);
    }, [name, rootNode.bid, state, sendAction]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleRename();
        if (e.key === 'Escape') {
            setName(state?.get_node_name(rootNode.bid) ?? '');
            setIsRenaming(false);
        }
    }, [handleRename, state, rootNode.bid]);

    const handleDragStart = useCallback((event: React.DragEvent) => {
        if (!state) return;
        event.stopPropagation();
        const movedNodeIds = Array.from(state.nodes.keys());
        const dragData: DragData = {
            type: 'window',
            draggedNodeId: rootNode.bid,
            sourceWindowId: rootNode.wbid,
            movedNodeIds,
        };
        event.dataTransfer.setData('application/json', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'move';
        setTimeout(() => event.currentTarget.parentElement?.classList.add('dragging'), 0);
    }, [state, rootNode]);

    const handleDragEnd = useCallback((event: React.DragEvent) => {
        event.currentTarget.parentElement?.classList.remove('dragging');
    }, []);

    const nodeName = state?.get_node_name(rootNode.bid) ?? '';
    const displayText = isClosed ? `[Closed] ${nodeName}` : nodeName;

    return (
        <div className="tab-tree-header" draggable onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            {isRenaming ? (
                <input
                    ref={inputRef}
                    type="text"
                    className="group-name-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={handleRename}
                    onKeyDown={handleKeyDown}
                />
            ) : (
                <span className="group-name" onClick={() => setIsRenaming(true)}>
                    {displayText}
                </span>
            )}
            <button
                className="group-menu-button"
                onClick={(e) => {
                    e.stopPropagation();
                    showGroupContextMenu(e.clientX, e.clientY, rootNode.bid, isClosed);
                }}
            >
                &#x22EE;
            </button>
        </div>
    );
};
