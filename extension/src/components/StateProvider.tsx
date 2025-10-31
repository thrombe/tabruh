import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useRef, useReducer } from 'react';
import browser from 'webextension-polyfill';
import { State } from '../state';
import * as utils from '../utils';
import type { AppRequest, StateAction, BruhUiEvent, ExtensionAction, AppEffect } from '../types';

type StateContextType = {
    state: State | null;
    port: browser.Runtime.Port | null;
    sendAction: (action: StateAction) => void;
    sendRequest: (request: AppRequest) => void;
};

const StateContext = createContext<StateContextType>({
    state: null,
    port: null,
    sendAction: () => { },
    sendRequest: () => { },
});

export const useStateContext = () => useContext(StateContext);

export const StateProvider: React.FC<{ children: ReactNode, connectionName: string }> = ({ children, connectionName }) => {
    const stateRef = useRef<State | null>(null);
    const [port, setPort] = useState<browser.Runtime.Port | null>(null);
    const [, forceUpdate] = useReducer(x => x + 1, 0);

    useEffect(() => {
        let isConnected = true;
        const localPort = browser.runtime.connect({ name: connectionName });
        setPort(localPort);

        const handleMessage = (message: BruhUiEvent) => {
            if (!isConnected) return;
            switch (message.type) {
                case 'app_response':
                    if (message.payload.type === 'initial_state') {
                        // Initialize the state instance ONCE from the clonable state.
                        const freshState = State.from_clonable_state(message.payload.payload);
                        stateRef.current = freshState;
                        // @ts-ignore
                        globalThis.state = freshState;
                        forceUpdate(); // Trigger the first render
                    }
                    // other app_response types are handled inline in settings/overview pages
                    break;
                case 'state_effect':
                case 'state_action':
                    // Mutate the EXISTING state instance directly. No more cloning.
                    if (stateRef.current) {
                        const app_effects = new utils.Deque<AppEffect>();
                        stateRef.current.handle_event({ type: message.type, payload: message.payload as any }, app_effects);
                        // @ts-ignore
                        globalThis.state = stateRef.current;
                        forceUpdate(); // Notify React that a re-render is needed.
                    }
                    break;
            }
        };

        localPort.onMessage.addListener(handleMessage);

        localPort.onDisconnect.addListener(() => {
            isConnected = false;
            setPort(null);
            console.error(`${connectionName} disconnected.`);
        });

        // Request initial state on connect
        const requestInitialState: AppRequest = { type: 'get_initial_state', payload: {} };
        const message: ExtensionAction = { type: 'app_request', payload: requestInitialState };
        localPort.postMessage(message);

        return () => {
            isConnected = false;
            localPort.onMessage.removeListener(handleMessage);
            if (localPort) {
                try {
                    localPort.disconnect();
                } catch (e) {
                    // Port might already be disconnected
                }
            }
        };
    }, [connectionName]);

    const sendAction = useCallback((action: StateAction) => {
        if (!port) return;
        const message: ExtensionAction = { type: 'state_action', payload: action };
        port.postMessage(message);
    }, [port]);

    const sendRequest = useCallback((request: AppRequest) => {
        if (!port) return;
        const message: ExtensionAction = { type: 'app_request', payload: request };
        port.postMessage(message);
    }, [port]);

    const value = { state: stateRef.current, port, sendAction, sendRequest };

    return <StateContext.Provider value={value}>{children}</StateContext.Provider>;
};
