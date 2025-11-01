import './new.css';
import browser from 'webextension-polyfill';
import type { AppRequest, BruhUiEvent, ExtensionAction } from './types';
import { State } from './state';
import * as svg from './svg';

const container = document.getElementById('container');
if (!container) throw new Error('Container not found');

const urlParams = new URLSearchParams(window.location.search);
const original_url = urlParams.get('original_url');


if (original_url) {
    // Case 1: Display error for a "funny" URL
    document.title = "URL Error";
    container.innerHTML = `
        <div class="title">Tabruh cannot open this URL:</div>
        <div class="url-container">
            <div class="url-display">${escapeHTML(original_url)}</div>
            <button id="copy-button" class="copy-button" title="Copy URL">${svg.icon_copy}</button>
        </div>
    `;

    const copyButton = document.getElementById('copy-button');
    if (copyButton) {
        copyButton.addEventListener('click', () => {
            if (copyButton.classList.contains('copied')) return; // Prevent multiple clicks

            navigator.clipboard.writeText(original_url).then(() => {
                copyButton.innerHTML = svg.icon_tick;
                copyButton.classList.add('copied');
                setTimeout(() => {
                    copyButton.innerHTML = svg.icon_copy;
                    copyButton.classList.remove('copied');
                }, 1000);
            }).catch(err => {
                console.error('Failed to copy URL: ', err);
            });
        });
    }

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
                    window.location.replace(redirectUrl); // Use replace to avoid polluting browser history
                } catch (e) {
                    console.error("Invalid redirect URL provided in settings:", redirectUrl);
                    document.title = "Invalid URL";
                    container.innerHTML = `<div class="title">Invalid Redirect URL in Settings</div>`;
                }
            } else {
                document.title = "New Tab";
                // You can add a default welcome message here if you want
                // container.innerHTML = `<div class="title">Welcome to Tabruh</div>`;
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
