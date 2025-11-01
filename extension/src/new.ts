import './new.css';
import browser from 'webextension-polyfill';
import type { AppRequest, BruhUiEvent, ExtensionAction } from './types';
import { State } from './state';

const container = document.getElementById('container');
if (!container) throw new Error('Container not found');

const urlParams = new URLSearchParams(window.location.search);
const original_url = urlParams.get('original_url');

if (original_url) {
    // Case 1: Display error for a "funny" URL
    document.title = "URL Error";
    container.innerHTML = `
        <div class="title">Tabruh cannot open this URL:</div>
        <div class="url-display">${escapeHTML(original_url)}</div>
    `;
} else {
    // Case 2: Standard new tab, check for user-defined redirect
    const port = browser.runtime.connect({ name: 'new-tab-connection' });

    port.onMessage.addListener((message: BruhUiEvent) => {
        if (message.type === 'app_response' && message.payload.type === 'initial_state') {
            const state = State.from_clonable_state(message.payload.payload);
            const redirectUrl = state.user_config.new_tab_url;

            if (redirectUrl && redirectUrl.trim() !== '') {
                try {
                    // Validate URL before redirecting
                    new URL(redirectUrl);
                    window.location.href = redirectUrl;
                } catch (e) {
                    console.error("Invalid redirect URL provided in settings:", redirectUrl);
                    // Fallback to a blank page if user URL is invalid
                    document.title = "New Tab";
                }
            } else {
                // No redirect configured, show a blank page or a welcome message
                document.title = "New Tab";
            }
        }
    });

    const request: AppRequest = { type: 'get_initial_state', payload: {} };
    const message: ExtensionAction = { type: 'app_request', payload: request };
    port.postMessage(message);
}

function escapeHTML(str: string): string {
    const p = document.createElement("p");
    p.appendChild(document.createTextNode(str));
    return p.innerHTML;
}
