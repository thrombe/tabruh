// hooks/useContextMenu.ts
import { useState, useCallback, useEffect } from 'react';

type ContextMenuState = {
    x: number;
    y: number;
    visible: boolean;
    content: React.ReactNode;
};

export const useContextMenu = () => {
    const [menuState, setMenuState] = useState<ContextMenuState>({ x: 0, y: 0, visible: false, content: null });

    const showMenu = useCallback((x: number, y: number, content: React.ReactNode) => {
        setMenuState({ x, y, visible: true, content });
    }, []);

    const hideMenu = useCallback(() => {
        setMenuState(prev => ({ ...prev, visible: false }));
    }, []);

    useEffect(() => {
        if (menuState.visible) {
            const handleClick = () => hideMenu();
            const handleContextMenu = () => hideMenu();
            const handleBlur = () => hideMenu();

            document.addEventListener('click', handleClick);
            document.addEventListener('contextmenu', handleContextMenu);
            window.addEventListener('blur', handleBlur);

            return () => {
                document.removeEventListener('click', handleClick);
                document.removeEventListener('contextmenu', handleContextMenu);
                window.removeEventListener('blur', handleBlur);
            };
        }
    }, [menuState.visible, hideMenu]);

    return { menuState, showMenu, hideMenu };
};

export const ContextMenuPortal: React.FC<{ menuState: ContextMenuState }> = ({ menuState }) => {
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const menuRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (menuState.visible && menuRef.current) {
            const menuWidth = menuRef.current.offsetWidth;
            const menuHeight = menuRef.current.offsetHeight;
            const viewWidth = document.documentElement.clientWidth;
            const viewHeight = document.documentElement.clientHeight;

            let finalX = menuState.x;
            let finalY = menuState.y;
            if (menuState.x + menuWidth > viewWidth) finalX = viewWidth - menuWidth - 5;
            if (menuState.y + menuHeight > viewHeight) finalY = viewHeight - menuHeight - 5;
            finalX = Math.max(5, finalX);
            finalY = Math.max(5, finalY);

            setPosition({ top: finalY, left: finalX });
        }
    }, [menuState.x, menuState.y, menuState.visible]);

    if (!menuState.visible) return null;

    return (
        <div
            ref={menuRef}
            id="tab-context-menu"
            className="context-menu"
            style={{ left: position.left, top: position.top, visibility: menuState.visible ? 'visible' : 'hidden' }}
            onClick={(e) => e.stopPropagation()}
        >
            {menuState.content}
        </div>
    );
};
