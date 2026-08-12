// ==UserScript==
// @name         Mine Recruiter
// @namespace    MonChoon_
// @version      2.9.2
// @description  Adds recruit buttons to the User Search page. Opens chat and pre-fills recruitment message. Uses Torn API v2 to enrich user data.
// @license      MIT
// @author       MonChoon [2250591]
// @match        https://www.torn.com/page.php*
// @connect      api.torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @downloadURL https://github.com/DobrowneyT/torn-userscripts/raw/main/mine-recruiter.js
// @updateURL https://github.com/DobrowneyT/torn-userscripts/raw/main/mine-recruiter.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================
    const DEFAULT_RECRUIT_MESSAGE =
        "Hey mate, we are hiring for our Mine with awesome perks, free trains and pay up to 4m/day. " +
        "Let me know your stats if you're interested. Apply here " +
        "https://www.torn.com/joblist.php#/p=corpinfo&ID=121367&referredFrom=2250591";

    function getRecruitMessage() {
        return GM_getValue('mine_recruit_message', DEFAULT_RECRUIT_MESSAGE);
    }
    function setRecruitMessage(msg) {
        GM_setValue('mine_recruit_message', msg);
    }
    function RECRUIT_MESSAGE() { return getRecruitMessage(); }

    const WAIT_TIMEOUT = 7000;
    const WAIT_POLL    = 100;

    // =========================================================================
    // ENRICHMENT SETTINGS
    // =========================================================================
    const DEFAULT_ENRICH_SETTINGS = {
        enabled:         true,
        minJobPoints:    50,
        minTrains:       0,
        minAge:          900,
        requireFaction:  false,
        minStreak:       0,
        goodThreshold:   5,
        maybeThreshold:  2
    };

    function getEnrichSettings() {
        try {
            const stored = JSON.parse(GM_getValue('mine_enrich_settings', 'null'));
            return Object.assign({}, DEFAULT_ENRICH_SETTINGS, stored || {});
        } catch(e) { return Object.assign({}, DEFAULT_ENRICH_SETTINGS); }
    }
    function saveEnrichSettings(s) {
        GM_setValue('mine_enrich_settings', JSON.stringify(s));
    }

    // =========================================================================
    // API KEY STORAGE
    // =========================================================================
    function getApiKey() { return GM_getValue('mine_recruiter_api_key', null); }
    function setApiKey(k) { GM_setValue('mine_recruiter_api_key', k); }

    function promptForApiKey() {
        const key = prompt(
            '[Mine Recruiter] Enter your Torn API key (Limited Access or higher).\n' +
            'Stored locally via Tampermonkey — only ever sent to api.torn.com.'
        );
        if (key && key.trim().length >= 10) {
            setApiKey(key.trim());
            return key.trim();
        }
        alert('[Mine Recruiter] No valid key provided. Enrichment will be disabled.');
        return null;
    }

    // =========================================================================
    // ONLY run on the UserList search page
    // =========================================================================
    const params = new URLSearchParams(window.location.search);
    if (params.get('sid') !== 'UserList') return;

    // =========================================================================
    // STYLES
    // =========================================================================
    const style = document.createElement('style');
    style.textContent = `
        .mine-recruit-btn {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: bold;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            white-space: nowrap;
            line-height: 1.6;
            flex-shrink: 0;
            transition: background 0.15s;
        }
        .mine-recruit-btn.ready        { background: #3a7d3a; color: #fff; }
        .mine-recruit-btn.ready:hover  { background: #2e632e; }
        .mine-recruit-btn.loading      { background: #888; color: #fff; cursor: default; pointer-events: none; }
        .mine-recruit-btn.sent         { background: #1a5a9e; color: #fff; cursor: default; pointer-events: none; }
        .mine-recruit-btn.action       { background: #1a5a9e; color: #fff; cursor: pointer; pointer-events: auto; }
        .mine-recruit-btn.action:hover { background: #0e3d6e; }
        .mine-recruit-btn.warn         { background: #7b4a00; color: #fff; cursor: pointer; pointer-events: auto; }
        .mine-recruit-btn.warn:hover   { background: #5a3600; }
        .mine-recruit-btn.send-ready   { background: #a05000; color: #fff; cursor: pointer; pointer-events: auto; }
        .mine-recruit-btn.send-ready:hover { background: #7b3c00; }
        .mine-recruit-btn.skip         { background: #444; color: #888; cursor: default; pointer-events: none; }

        .mine-enrich-badge {
            display: inline-block;
            font-size: 10px;
            padding: 1px 5px;
            border-radius: 10px;
            margin-left: 5px;
            vertical-align: middle;
            font-weight: bold;
            flex-shrink: 0;
        }
        .mine-enrich-badge.good    { background: #2e7d32; color: #fff; }
        .mine-enrich-badge.maybe   { background: #e65100; color: #fff; }
        .mine-enrich-badge.skip    { background: #444;    color: #888; }
        .mine-enrich-badge.loading { background: #333;    color: #777; }

        #mine-recruiter-header {
            display: flex;
            align-items: center;
            gap: 10px;
            background: linear-gradient(90deg, #1a3a1a, #2e5c2e);
            color: #fff;
            font-size: 12px;
            padding: 5px 10px;
            border-radius: 4px;
            margin-bottom: 6px;
        }
        #mine-recruiter-header button {
            padding: 2px 8px;
            font-size: 11px;
            border: 1px solid rgba(255,255,255,0.3);
            background: rgba(255,255,255,0.15);
            color: #fff;
            border-radius: 3px;
            cursor: pointer;
        }
        #mine-recruiter-header button:hover { background: rgba(255,255,255,0.25); }

        .userlist-wrapper .level-icons-wrap {
            display: flex !important;
            align-items: center;
            gap: 4px;
        }
        .userlist-wrapper .level-icons-wrap .user-icons { flex: 1; }

        .mine-overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.6);
            z-index: 999999;
            align-items: center;
            justify-content: center;
        }
        .mine-overlay.visible { display: flex; }
        .mine-modal {
            background: #1e1e1e;
            border: 1px solid #444;
            border-radius: 6px;
            padding: 16px;
            width: 480px;
            max-width: 95vw;
            display: flex;
            flex-direction: column;
            gap: 10px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.6);
            color: #eee;
            font-size: 12px;
        }
        .mine-modal h3 { margin: 0; color: #fff; font-size: 14px; }

        #mine-msg-textarea {
            width: 100%;
            min-height: 100px;
            background: #2a2a2a;
            color: #eee;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 8px;
            font-size: 12px;
            line-height: 1.5;
            resize: vertical;
            box-sizing: border-box;
            font-family: inherit;
        }
        #mine-msg-textarea:focus { outline: none; border-color: #3a7d3a; }
        .mine-modal-btns {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }
        .mine-modal-btns button, .mine-settings-btns button {
            padding: 4px 14px;
            font-size: 12px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-weight: bold;
        }
        .btn-save       { background: #3a7d3a; color: #fff; }
        .btn-save:hover { background: #2e632e; }
        .btn-danger       { background: #7d1e1e; color: #fff; }
        .btn-danger:hover { background: #5a1515; }
        .btn-neutral       { background: #555; color: #ccc; }
        .btn-neutral:hover { background: #444; }
        .btn-cancel       { background: #333; color: #aaa; }
        .btn-cancel:hover { background: #2a2a2a; }

        .mine-settings-section {
            background: #252525;
            border: 1px solid #383838;
            border-radius: 4px;
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .mine-settings-section h4 {
            margin: 0;
            color: #bbb;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .mine-settings-row {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .mine-settings-row label { flex: 1; color: #ccc; }
        .mine-settings-row input[type="number"] {
            width: 80px;
            background: #2a2a2a;
            color: #eee;
            border: 1px solid #555;
            border-radius: 3px;
            padding: 4px 6px;
            box-sizing: border-box;
        }
        .history-stats { color: #888; font-size: 11px; }
        .mine-settings-btns {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }
    `;
    document.head.appendChild(style);

    // =========================================================================
    // RESILIENT CHAT ELEMENT FINDERS
    //
    // Torn's chat app uses minified CSS class names (e.g. textarea___V8HsV)
    // that change on every redeploy. These functions find elements by their
    // structural role instead of relying on specific class names.
    // =========================================================================

    // The chat input — only one <textarea> exists inside a chat panel
    function findChatTextarea(panel) {
        if (!panel) return null;
        return panel.querySelector('textarea');
    }

    // The send button — lives next to the textarea in the input row
    function findSendButton(panel) {
        if (!panel) return null;
        // Partial class match survives hash changes in the class name
        const byPartial = panel.querySelector('[class*="iconWrapper"]');
        if (byPartial) return byPartial;
        // Structural fallback: button that shares a parent div with the textarea
        const ta = panel.querySelector('textarea');
        if (ta && ta.parentElement) {
            const btn = ta.parentElement.querySelector('button');
            if (btn) return btn;
        }
        return null;
    }

    // The close (X) button in the panel header
    function findCloseButton(panel) {
        if (!panel) return null;
        // Partial class match
        const byPartial = panel.querySelector('[class*="closeIcon"]');
        if (byPartial) return byPartial;
        // Fallback: SVG/element with aria-label="Close" and a tabindex (unique to close btn)
        return panel.querySelector('[aria-label="Close"][tabindex]');
    }

    // =========================================================================
    // REACT TEXTAREA/INPUT HACK
    // =========================================================================
    function setReactTextareaValue(textarea, value) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        nativeSetter.call(textarea, value);
        textarea.dispatchEvent(new Event('input',  { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setReactInputValue(input, value) {
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(input, value);
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // =========================================================================
    // WAIT UTILITIES
    // =========================================================================
    function waitFor(selectorOrFn, timeout, root) {
        timeout = timeout || WAIT_TIMEOUT;
        root    = root    || document;
        return new Promise(function(resolve, reject) {
            const start = Date.now();
            function tick() {
                const el = typeof selectorOrFn === 'function'
                    ? selectorOrFn()
                    : root.querySelector(selectorOrFn);
                if (el) return resolve(el);
                if (Date.now() - start > timeout) return reject(new Error('Timeout waiting for element'));
                setTimeout(tick, WAIT_POLL);
            }
            tick();
        });
    }

    function waitForSendButton(chatPanel, timeout) {
        timeout = timeout || 3000;
        return new Promise(function(resolve, reject) {
            const start = Date.now();
            function tick() {
                const btn = findSendButton(chatPanel);
                if (btn && !btn.disabled && !btn.hasAttribute('disabled')) return resolve(btn);
                if (Date.now() - start > timeout) return reject(new Error('Send button not enabled'));
                setTimeout(tick, 50);
            }
            tick();
        });
    }

    // =========================================================================
    // USER ID
    // =========================================================================
    function getMyUserId() {
        const tornUser = document.getElementById('torn-user');
        if (tornUser) {
            try { return JSON.parse(tornUser.value).id; } catch(e) {}
        }
        const wsData = document.getElementById('websocketConnectionData');
        if (wsData) {
            try { return JSON.parse(wsData.value || wsData.textContent).userID; } catch(e) {}
        }
        return null;
    }

    // =========================================================================
    // CHAT PANEL HELPERS
    // =========================================================================
    function waitForChatPanel(userId) {
        return new Promise(function(resolve, reject) {
            const start = Date.now();
            function tick() {
                const panels = document.querySelectorAll('div[id^="private-"]');
                for (let i = 0; i < panels.length; i++) {
                    if (panels[i].id.includes(userId)) return resolve(panels[i]);
                }
                if (Date.now() - start > WAIT_TIMEOUT) return reject(new Error('Chat panel for ' + userId + ' did not open'));
                setTimeout(tick, WAIT_POLL);
            }
            tick();
        });
    }

    function getChatPanel(userId) {
        const myId = getMyUserId();
        if (myId) {
            const a = document.getElementById('private-' + myId + '-' + userId);
            if (a) return a;
            const b = document.getElementById('private-' + userId + '-' + myId);
            if (b) return b;
        }
        const panels = document.querySelectorAll('div[id^="private-"]');
        for (let i = 0; i < panels.length; i++) {
            if (panels[i].id.includes(userId)) return panels[i];
        }
        return null;
    }

    function closeChatPanel(chatPanel, userId) {
        if (!chatPanel) return;
        const closeBtn = findCloseButton(chatPanel);
        if (closeBtn) {
            closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return;
        }
        const myId = getMyUserId();
        if (myId) {
            const trayBtn = document.getElementById('channel_panel_button:private-' + myId + '-' + userId);
            if (trayBtn) { trayBtn.click(); return; }
            const trayBtn2 = document.getElementById('channel_panel_button:private-' + userId + '-' + myId);
            if (trayBtn2) trayBtn2.click();
        }
    }

    // =========================================================================
    // MESSAGED HISTORY
    // =========================================================================
    function getHistory() {
        try { return JSON.parse(GM_getValue('mine_messaged_history', '{}')); }
        catch(e) { return {}; }
    }
    function saveHistory(h) { GM_setValue('mine_messaged_history', JSON.stringify(h)); }

    function markMessaged(userId) {
        const h = getHistory();
        h[userId] = Date.now();
        saveHistory(h);
    }

    function wasMessaged(userId) { return !!getHistory()[userId]; }

    function getMessagedDate(userId) {
        const ts = getHistory()[userId];
        return ts ? new Date(ts) : null;
    }

    function clearHistoryOlderThan(days) {
        const h = getHistory();
        const now = Date.now();
        let removed = 0;
        if (days <= 0) {
            removed = Object.keys(h).length;
            saveHistory({});
        } else {
            const cutoff = days * 86400000;
            for (const uid in h) {
                if (now - h[uid] >= cutoff) { delete h[uid]; removed++; }
            }
            saveHistory(h);
        }
        return removed;
    }

    function getHistoryStats() {
        const h = getHistory();
        const now = Date.now();
        const entries = Object.entries(h);
        const total = entries.length;
        if (total === 0) return { total: 0, oldestDays: null, newestDays: null };
        const ts = entries.map(([,t]) => t).sort((a,b) => a-b);
        return {
            total,
            oldestDays: Math.floor((now - ts[0]) / 86400000),
            newestDays: Math.floor((now - ts[ts.length-1]) / 86400000)
        };
    }

    // =========================================================================
    // PER-USER STATE MACHINE
    //
    //  idle → mini_open → chat_open → pasted → sent → idle
    //
    //  Click 1: open mini-profile
    //  Click 2: open chat
    //  Click 3: paste message into chat
    //  Click 4: click send button
    //  Click 5: mark messaged + close chat
    // =========================================================================
    const recruitState = {};

    async function openChatAndFill(userId, btn) {
        try {
            const myId = getMyUserId();
            if (!myId) throw new Error('Could not determine your user ID from page');

            const state = recruitState[userId] || 'idle';

            // ═══════════════════════════════════════════════════════════════
            // CLICK 5 — add to database + close chat
            // ═══════════════════════════════════════════════════════════════
            if (state === 'sent') {
                const chatPanel = getChatPanel(userId);
                if (chatPanel) closeChatPanel(chatPanel, userId);
                markMessaged(userId);
                recruitState[userId] = 'idle';
                btn.className = 'mine-recruit-btn skip';
                btn.style.background = '#2e632e';
                btn.textContent = '✓ Messaged';
                btn.title = 'Messaged ' + new Date().toLocaleDateString();
                refreshHeaderCount();
                return;
            }

            // ═══════════════════════════════════════════════════════════════
            // CLICK 4 — click the send button
            // ═══════════════════════════════════════════════════════════════
            if (state === 'pasted') {
                const chatPanel = getChatPanel(userId);
                if (!chatPanel) {
                    markMessaged(userId);
                    recruitState[userId] = 'idle';
                    btn.className = 'mine-recruit-btn skip';
                    btn.style.background = '#2e632e';
                    btn.textContent = '✓ Messaged';
                    btn.title = 'Messaged ' + new Date().toLocaleDateString();
                    refreshHeaderCount();
                    return;
                }

                btn.className = 'mine-recruit-btn loading';
                btn.textContent = '⏳ Sending...';

                try {
                    const sendBtn = await waitForSendButton(chatPanel, 3000);
                    sendBtn.click();
                } catch(e) {
                    console.warn('[Mine Recruiter] Send btn not enabled, trying Enter:', e.message);
                    const textarea = findChatTextarea(chatPanel);
                    if (textarea) {
                        textarea.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                            bubbles: true, cancelable: true
                        }));
                        textarea.dispatchEvent(new KeyboardEvent('keyup', {
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                            bubbles: true, cancelable: true
                        }));
                    }
                }

                recruitState[userId] = 'sent';
                btn.className = 'mine-recruit-btn action';
                btn.style.background = '';
                btn.textContent = '✅ Click to close & save';
                btn.title = 'Message sent — click to close chat and add to database';
                return;
            }

            // ═══════════════════════════════════════════════════════════════
            // CLICK 3 — paste message into the open chat textarea
            // ═══════════════════════════════════════════════════════════════
            if (state === 'chat_open') {
                const chatPanel = getChatPanel(userId);

                if (!chatPanel) {
                    const allPanels = Array.from(document.querySelectorAll('div[id^="private-"]'))
                        .map(p => p.id).join(', ');
                    console.warn('[Mine Recruiter] paste: panel not found for user ' + userId +
                        ' (myId=' + myId + '). Open panels: [' + (allPanels || 'none') + ']');
                }

                const textarea = findChatTextarea(chatPanel);

                // Always copy to clipboard as backup
                navigator.clipboard.writeText(RECRUIT_MESSAGE()).catch(function() {});

                if (textarea) {
                    textarea.focus();
                    setReactTextareaValue(textarea, RECRUIT_MESSAGE());
                    recruitState[userId] = 'pasted';
                    btn.className = 'mine-recruit-btn send-ready';
                    btn.style.background = '';
                    btn.textContent = '📨 Click to send';
                    btn.title = 'Message pasted — click to send';
                } else {
                    recruitState[userId] = 'pasted';
                    btn.className = 'mine-recruit-btn warn';
                    btn.style.background = '';
                    btn.textContent = '📋 Copied — paste manually, then click send';
                    btn.title = 'Textarea not found — message copied to clipboard. Paste manually, then click to send.';
                }
                return;
            }

            // ═══════════════════════════════════════════════════════════════
            // TRAY FAST PATH — chat was previously minimised to the tray
            // ═══════════════════════════════════════════════════════════════
            const trayBtnId = 'channel_panel_button:private-' + myId + '-' + userId;
            const trayBtn   = document.getElementById(trayBtnId);
            if (trayBtn && recruitState[userId] !== 'mini_open') {
                btn.className = 'mine-recruit-btn loading';
                btn.textContent = '⏳ Opening...';
                trayBtn.click();
                const chatPanel = await waitForChatPanel(userId);
                await waitFor(() => findChatTextarea(chatPanel), 4000);
                recruitState[userId] = 'chat_open';
                btn.className = 'mine-recruit-btn action';
                btn.style.background = '';
                btn.textContent = '⛏ Click to paste message';
                btn.title = 'Chat open — click to paste recruitment message';
                return;
            }

            // ═══════════════════════════════════════════════════════════════
            // CLICK 2 — mini-profile is open, open the chat
            // ═══════════════════════════════════════════════════════════════
            const miniChatBtn = document.getElementById('mini-button2-profile-' + userId);
            if (miniChatBtn) {
                if (!miniChatBtn.classList.contains('active')) {
                    markMessaged(userId);
                    recruitState[userId] = 'idle';
                    btn.className = 'mine-recruit-btn skip';
                    btn.style.background = '#2e632e';
                    btn.textContent = '✓ Skipped (chat blocked)';
                    btn.title = 'Chat disabled — marked as handled';
                    refreshHeaderCount();
                    return;
                }
                btn.className = 'mine-recruit-btn loading';
                btn.textContent = '⏳ Opening chat...';
                miniChatBtn.click();
                const chatPanel = await waitForChatPanel(userId);
                await waitFor(() => findChatTextarea(chatPanel), 4000);
                recruitState[userId] = 'chat_open';
                btn.className = 'mine-recruit-btn action';
                btn.style.background = '';
                btn.textContent = '⛏ Click to paste message';
                btn.title = 'Chat open — click to paste recruitment message';
                return;
            }

            // ═══════════════════════════════════════════════════════════════
            // CLICK 1 — first click, open mini-profile
            // ═══════════════════════════════════════════════════════════════
            const row = document.querySelector('li.user' + userId) ||
                        document.querySelector('li[class*="user' + userId + '"]');
            if (!row) throw new Error('Row not found for user ' + userId);

            const nameLink = row.querySelector('a.user.name') ||
                             row.querySelector('a[href*="profiles.php?XID=' + userId + '"]');
            if (!nameLink) throw new Error('Name link not found');

            const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const jq = uw.jQuery || uw.$;
            if (!jq) throw new Error('jQuery not found on page window');

            const suppressMouseup = function(e) { e.stopImmediatePropagation(); };
            nameLink.addEventListener('mouseup',  suppressMouseup, true);
            nameLink.addEventListener('touchend', suppressMouseup, true);
            setTimeout(function() {
                nameLink.removeEventListener('mouseup',  suppressMouseup, true);
                nameLink.removeEventListener('touchend', suppressMouseup, true);
            }, 650);

            let capturedNativeEvent = null;
            const captureAndStop = function(e) {
                capturedNativeEvent = e;
                e.stopImmediatePropagation();
            };
            nameLink.addEventListener('mousedown', captureAndStop, true);
            const rect = nameLink.getBoundingClientRect();
            nameLink.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true, cancelable: true, button: 0,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2
            }));
            nameLink.removeEventListener('mousedown', captureAndStop, true);

            const jqEvent = jq.Event('mousedown', { which: 1, button: 0 });
            jqEvent.originalEvent = capturedNativeEvent;
            jq(nameLink).trigger(jqEvent);

            recruitState[userId] = 'mini_open';
            btn.className = 'mine-recruit-btn ready';
            btn.style.background = '#7b4a00';
            btn.textContent = '⛏ Click to open chat';
            btn.title = 'Mini-profile opened — click again to start chat';

            const resetWatch = setInterval(function() {
                if (!document.getElementById('mini-button2-profile-' + userId)) {
                    clearInterval(resetWatch);
                    if (recruitState[userId] === 'mini_open') {
                        recruitState[userId] = 'idle';
                        btn.className = 'mine-recruit-btn ready';
                        btn.style.background = '';
                        btn.textContent = '⛏ Recruit';
                        btn.title = 'Open mini-profile (step 1 of 5)';
                    }
                }
            }, 300);
            setTimeout(function() { clearInterval(resetWatch); }, 30000);

        } catch (err) {
            console.warn('[Mine Recruiter] Error:', err.message);
            recruitState[userId] = 'idle';
            btn.className = 'mine-recruit-btn ready';
            btn.style.background = '';
            btn.textContent = '⛏ Recruit';
            clipboardFallback(btn);
        }
    }

    function clipboardFallback(btn) {
        navigator.clipboard.writeText(RECRUIT_MESSAGE()).then(function() {
            btn.className = 'mine-recruit-btn sent';
            btn.textContent = '📋 Copied — open chat manually';
            setTimeout(function() {
                btn.className = 'mine-recruit-btn ready';
                btn.textContent = '⛏ Recruit';
            }, 5000);
        }).catch(function() {
            btn.className = 'mine-recruit-btn ready';
            btn.textContent = '⛏ Recruit';
            alert('[Mine Recruiter] Could not open chat or copy to clipboard.');
        });
    }

    // =========================================================================
    // TORN API v2
    // =========================================================================
    function apiGet(url) {
        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method:  'GET',
                url:     url,
                headers: { 'Content-Type': 'application/json' },
                onload: function(res) {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.error) return reject(data.error.error || JSON.stringify(data.error));
                        resolve(data);
                    } catch(e) { reject('JSON parse error: ' + e.message); }
                },
                onerror: function(err) { reject('Request failed: ' + String(err)); }
            });
        });
    }

    async function fetchUserData(userId, apiKey) {
        const base = 'https://api.torn.com/v2/user/' + userId;
        const key  = '&key=' + apiKey;
        const [profileData, statsData] = await Promise.all([
            apiGet(base + '/profile?striptags=true' + key),
            apiGet(base + '/personalstats?cat=all&stat=&striptags=true' + key)
        ]);
        return {
            profile:       profileData.profile       || profileData,
            personalstats: statsData.personalstats   || statsData
        };
    }

    // =========================================================================
    // ENRICHMENT
    // =========================================================================
    function assessCandidate(profile, personalstats, settings) {
        const s = settings || getEnrichSettings();
        const reasons = [];
        let score = 0;

        const jobPoints = (personalstats.jobs && personalstats.jobs.job_points_used) || 0;
        const trains    = (personalstats.jobs && personalstats.jobs.trains_received)  || 0;

        if      (jobPoints >= 5000) { score += 4; reasons.push('jp:' + jobPoints); }
        else if (jobPoints >= 500)  { score += 3; reasons.push('jp:' + jobPoints); }
        else if (jobPoints >= 50)   { score += 1; reasons.push('jp:' + jobPoints); }
        else                        { score -= 1; reasons.push('jp:0'); }

        if (jobPoints < s.minJobPoints)
            return { rating: 'skip', reasons: ['jp:' + jobPoints + ' < min ' + s.minJobPoints], score: -99 };

        if      (trains >= 100) { score += 2; reasons.push('trains:' + trains); }
        else if (trains >= 20)  { score += 1; reasons.push('trains:' + trains); }

        if (s.minTrains > 0 && trains < s.minTrains)
            return { rating: 'skip', reasons: reasons.concat(['trains:' + trains + ' < min ' + s.minTrains]), score: -99 };

        const age = profile.age || 0;
        if      (age >= 1500) { score += 2; reasons.push(age + 'd'); }
        else if (age >= 1000) { score += 1; reasons.push(age + 'd'); }
        else                  {             reasons.push(age + 'd'); }

        if (age < s.minAge)
            return { rating: 'skip', reasons: reasons.concat([age + 'd < min ' + s.minAge + 'd']), score: -99 };

        const hasFaction = !!(profile.faction_id || (profile.faction && profile.faction.faction_id));
        if (hasFaction) { score += 1; reasons.push('faction'); }
        else            { reasons.push('no faction'); }

        if (s.requireFaction && !hasFaction)
            return { rating: 'skip', reasons: reasons.concat(['no faction required']), score: -99 };

        const bestStreak = (
            personalstats.other &&
            personalstats.other.activity &&
            personalstats.other.activity.streak &&
            personalstats.other.activity.streak.best
        ) || 0;
        if (bestStreak >= 365) { score += 1; reasons.push('streak:' + bestStreak); }

        if (s.minStreak > 0 && bestStreak < s.minStreak)
            return { rating: 'skip', reasons: reasons.concat(['streak:' + bestStreak + ' < min ' + s.minStreak]), score: -99 };

        const state = (profile.status && profile.status.state) || '';
        if (state === 'Hospital') { score -= 2; reasons.push('hosp'); }
        if (state === 'Jail')     { score -= 2; reasons.push('jailed'); }

        const rating = score >= s.goodThreshold  ? 'good'
                     : score >= s.maybeThreshold ? 'maybe'
                     :                             'skip';
        return { rating, reasons, score };
    }

    async function enrichRow(row, userId, apiKey) {
        const settings = getEnrichSettings();
        if (!settings.enabled) return;

        const levelSpan = row.querySelector('.level');
        const badge = document.createElement('span');
        badge.className = 'mine-enrich-badge loading';
        badge.textContent = '…';
        if (levelSpan) levelSpan.after(badge);

        const btn = row.querySelector('.mine-recruit-btn');

        try {
            const { profile, personalstats } = await fetchUserData(userId, apiKey);
            const { rating, reasons, score } = assessCandidate(profile, personalstats, settings);
            badge.className = 'mine-enrich-badge ' + rating;
            badge.textContent = reasons.slice(0, 3).join(' · ');
            badge.title = 'Score ' + score + ': ' + reasons.join(', ');
            if (rating === 'skip' && btn && btn.className.includes('ready')) {
                btn.className = 'mine-recruit-btn skip';
                btn.textContent = '✗ Skip';
                btn.title = reasons.join(', ');
            }
        } catch (err) {
            badge.className = 'mine-enrich-badge skip';
            badge.textContent = 'err';
            badge.title = String(err);
            console.warn('[Mine Recruiter] Enrichment failed for ' + userId + ':', err);
        }
    }

    // =========================================================================
    // BUILD BUTTON
    // =========================================================================
    function buildButton(userId) {
        const btn = document.createElement('button');
        if (wasMessaged(userId)) {
            const d = getMessagedDate(userId);
            const daysAgo = d ? Math.floor((Date.now() - d.getTime()) / 86400000) : '?';
            btn.className = 'mine-recruit-btn skip';
            btn.style.background = '#2e632e';
            btn.textContent = '✓ Messaged';
            btn.title = d
                ? 'Messaged ' + d.toLocaleDateString() + ' (' + daysAgo + 'd ago)'
                : 'Previously messaged';
        } else {
            btn.className = 'mine-recruit-btn ready';
            btn.textContent = '⛏ Recruit';
            btn.title = 'Open mini-profile (step 1 of 5)';
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                e.preventDefault();
                openChatAndFill(userId, btn);
            });
        }
        return btn;
    }

    // =========================================================================
    // PROCESS ROWS
    // =========================================================================
    function processRows(apiKey) {
        const settings = getEnrichSettings();
        const rows = document.querySelectorAll(
            '.userlist-wrapper .user-info-list-wrap > li[class*="user"]'
        );
        rows.forEach(function(row) {
            const m = row.className.match(/\buser(\d+)\b/);
            if (!m) return;
            const userId = m[1];
            if (row.querySelector('.mine-recruit-btn')) return;
            const iconsWrap = row.querySelector('.level-icons-wrap');
            if (!iconsWrap) return;
            iconsWrap.appendChild(buildButton(userId));
            if (settings.enabled && apiKey) enrichRow(row, userId, apiKey);
        });
    }

    // =========================================================================
    // HEADER COUNT REFRESH
    // =========================================================================
    function refreshHeaderCount() {
        const btn = document.getElementById('mine-clear-history-btn');
        if (btn) btn.textContent = '⚙ History (' + Object.keys(getHistory()).length + ')';
    }

    // =========================================================================
    // REFRESH BUTTONS after history clear
    // =========================================================================
    function refreshButtons() {
        document.querySelectorAll('.mine-recruit-btn.skip').forEach(function(btn) {
            if (!btn.textContent.includes('Messaged')) return;
            const li = btn.closest('li[class*="user"]');
            if (!li) return;
            const m = li.className.match(/\buser(\d+)\b/);
            if (!m) return;
            const uid = m[1];
            if (!wasMessaged(uid)) {
                recruitState[uid] = 'idle';
                const fresh = btn.cloneNode(true);
                btn.replaceWith(fresh);
                fresh.className = 'mine-recruit-btn ready';
                fresh.style.background = '';
                fresh.textContent = '⛏ Recruit';
                fresh.title = 'Open mini-profile (step 1 of 5)';
                fresh.addEventListener('click', function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                    openChatAndFill(uid, fresh);
                });
            }
        });
    }

    // =========================================================================
    // SETTINGS MODAL
    // =========================================================================
    function injectSettingsModal() {
        if (document.getElementById('mine-settings-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'mine-settings-overlay';
        overlay.className = 'mine-overlay';
        overlay.innerHTML = `
            <div class="mine-modal" style="width:460px;">
                <h3>⚙ History Settings</h3>
                <div class="mine-settings-section">
                    <h4>Messaged Users Database</h4>
                    <div class="history-stats" id="mine-history-stats">Loading…</div>
                </div>
                <div class="mine-settings-section">
                    <h4>Clear Users Older Than</h4>
                    <div class="mine-settings-row">
                        <label for="mine-clear-days">Remove entries older than</label>
                        <input type="number" id="mine-clear-days" min="1" value="30">
                        <span style="color:#888;">days</span>
                    </div>
                    <div style="color:#888;font-size:11px;">Only removes users messaged more than X days ago.</div>
                </div>
                <div class="mine-settings-section">
                    <h4>Clear All Users</h4>
                    <div style="color:#888;font-size:11px;margin-bottom:6px;">Wipes the entire database. All recruit buttons will reset.</div>
                    <button id="mine-clear-all-btn" class="btn-danger" style="align-self:flex-start;padding:4px 14px;font-size:12px;border:none;border-radius:3px;cursor:pointer;font-weight:bold;">🗑 Clear All</button>
                </div>
                <div class="mine-settings-btns">
                    <button id="mine-clear-older-btn" class="btn-save">Clear Older Than X Days</button>
                    <button id="mine-settings-close-btn" class="btn-cancel">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) overlay.classList.remove('visible');
        });
        document.getElementById('mine-settings-close-btn').addEventListener('click', function() {
            overlay.classList.remove('visible');
        });
        document.getElementById('mine-clear-older-btn').addEventListener('click', function() {
            const days = parseInt(document.getElementById('mine-clear-days').value) || 30;
            const h = getHistory();
            const now = Date.now();
            const cutoff = days * 86400000;
            const wouldRemove = Object.values(h).filter(ts => now - ts >= cutoff).length;
            if (wouldRemove === 0) { alert('[Mine Recruiter] No users older than ' + days + ' days.'); return; }
            if (confirm('[Mine Recruiter] Remove ' + wouldRemove + ' user(s) older than ' + days + ' days?')) {
                clearHistoryOlderThan(days);
                refreshSettingsStats();
                refreshHeaderCount();
                refreshButtons();
            }
        });
        document.getElementById('mine-clear-all-btn').addEventListener('click', function() {
            const count = Object.keys(getHistory()).length;
            if (count === 0) { alert('[Mine Recruiter] History is already empty.'); return; }
            if (confirm('[Mine Recruiter] Clear ALL ' + count + ' user(s) from history?')) {
                clearHistoryOlderThan(0);
                refreshSettingsStats();
                refreshHeaderCount();
                refreshButtons();
            }
        });
    }

    function refreshSettingsStats() {
        const el = document.getElementById('mine-history-stats');
        if (!el) return;
        const stats = getHistoryStats();
        el.textContent = stats.total === 0
            ? 'No users in database.'
            : stats.total + ' user(s) stored. Oldest: ' + stats.oldestDays + 'd ago. Most recent: ' + stats.newestDays + 'd ago.';
    }

    function openSettingsModal() {
        const overlay = document.getElementById('mine-settings-overlay');
        if (!overlay) return;
        refreshSettingsStats();
        overlay.classList.add('visible');
    }

    // =========================================================================
    // MESSAGE EDIT MODAL
    // =========================================================================
    function injectMessageModal() {
        if (document.getElementById('mine-msg-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'mine-msg-overlay';
        overlay.className = 'mine-overlay';
        overlay.innerHTML = `
            <div class="mine-modal">
                <h3>✏ Edit Recruitment Message</h3>
                <textarea id="mine-msg-textarea" spellcheck="true"></textarea>
                <div class="mine-modal-btns">
                    <button id="mine-msg-reset" class="btn-neutral" title="Restore original default">Reset to default</button>
                    <button id="mine-msg-cancel" class="btn-cancel">Cancel</button>
                    <button id="mine-msg-save" class="btn-save">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) overlay.classList.remove('visible');
        });
        document.getElementById('mine-msg-cancel').addEventListener('click', function() {
            overlay.classList.remove('visible');
        });
        document.getElementById('mine-msg-reset').addEventListener('click', function() {
            if (confirm('Reset to default message?'))
                document.getElementById('mine-msg-textarea').value = DEFAULT_RECRUIT_MESSAGE;
        });
        document.getElementById('mine-msg-save').addEventListener('click', function() {
            const v = document.getElementById('mine-msg-textarea').value.trim();
            if (!v) { alert('Message cannot be empty.'); return; }
            setRecruitMessage(v);
            overlay.classList.remove('visible');
        });
    }

    function openMessageModal() {
        const overlay = document.getElementById('mine-msg-overlay');
        if (!overlay) return;
        document.getElementById('mine-msg-textarea').value = getRecruitMessage();
        overlay.classList.add('visible');
        document.getElementById('mine-msg-textarea').focus();
    }

    // =========================================================================
    // ENRICHMENT FILTERS MODAL
    // =========================================================================
    function injectFiltersModal() {
        if (document.getElementById('mine-filters-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'mine-filters-overlay';
        overlay.className = 'mine-overlay';
        overlay.innerHTML = `
            <div class="mine-modal" style="width:420px;">
                <h3>⚙ Enrichment Filters</h3>
                <p style="margin:0;color:#888;font-size:11px;">Hard minimums skip users outright. Score thresholds control badge colour.</p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;align-items:center;">
                    <label>Min Job Points</label>
                    <input type="number" id="mf-minJobPoints" min="0" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:3px;padding:4px 6px;width:100%;box-sizing:border-box;">
                    <label>Min Trains (0=off)</label>
                    <input type="number" id="mf-minTrains" min="0" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:3px;padding:4px 6px;width:100%;box-sizing:border-box;">
                    <label>Min Age (days)</label>
                    <input type="number" id="mf-minAge" min="0" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:3px;padding:4px 6px;width:100%;box-sizing:border-box;">
                    <label>Require Faction</label>
                    <input type="checkbox" id="mf-requireFaction" style="width:16px;height:16px;accent-color:#3a7d3a;">
                    <label>Min Best Streak (0=off)</label>
                    <input type="number" id="mf-minStreak" min="0" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:3px;padding:4px 6px;width:100%;box-sizing:border-box;">
                    <label>Good Score Threshold</label>
                    <input type="number" id="mf-goodThreshold" min="1" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:3px;padding:4px 6px;width:100%;box-sizing:border-box;">
                    <label>Maybe Score Threshold</label>
                    <input type="number" id="mf-maybeThreshold" min="0" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:3px;padding:4px 6px;width:100%;box-sizing:border-box;">
                </div>
                <div class="mine-modal-btns">
                    <button id="mf-reset" class="btn-neutral">Reset to defaults</button>
                    <button id="mf-cancel" class="btn-cancel">Cancel</button>
                    <button id="mf-save" class="btn-save">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.classList.remove('visible'); });
        document.getElementById('mf-cancel').addEventListener('click', function() { overlay.classList.remove('visible'); });
        document.getElementById('mf-reset').addEventListener('click', function() {
            if (confirm('Reset all filters to defaults?')) populateFiltersModal(DEFAULT_ENRICH_SETTINGS);
        });
        document.getElementById('mf-save').addEventListener('click', function() {
            const s = getEnrichSettings();
            s.minJobPoints   = parseInt(document.getElementById('mf-minJobPoints').value)   || 0;
            s.minTrains      = parseInt(document.getElementById('mf-minTrains').value)       || 0;
            s.minAge         = parseInt(document.getElementById('mf-minAge').value)          || 0;
            s.requireFaction = document.getElementById('mf-requireFaction').checked;
            s.minStreak      = parseInt(document.getElementById('mf-minStreak').value)       || 0;
            s.goodThreshold  = parseInt(document.getElementById('mf-goodThreshold').value)   || 5;
            s.maybeThreshold = parseInt(document.getElementById('mf-maybeThreshold').value)  || 2;
            saveEnrichSettings(s);
            overlay.classList.remove('visible');
        });
    }

    function populateFiltersModal(s) {
        document.getElementById('mf-minJobPoints').value    = s.minJobPoints;
        document.getElementById('mf-minTrains').value       = s.minTrains;
        document.getElementById('mf-minAge').value          = s.minAge;
        document.getElementById('mf-requireFaction').checked = s.requireFaction;
        document.getElementById('mf-minStreak').value       = s.minStreak;
        document.getElementById('mf-goodThreshold').value   = s.goodThreshold;
        document.getElementById('mf-maybeThreshold').value  = s.maybeThreshold;
    }

    function openFiltersModal() {
        const overlay = document.getElementById('mine-filters-overlay');
        if (!overlay) return;
        populateFiltersModal(getEnrichSettings());
        overlay.classList.add('visible');
    }

    // =========================================================================
    // HEADER
    // =========================================================================
    function injectHeader(apiKey) {
        if (document.getElementById('mine-recruiter-header')) return;

        const header = document.createElement('div');
        header.id = 'mine-recruiter-header';

        const label = document.createElement('span');
        label.innerHTML = '<b>⛏ Mine Recruiter</b>';

        const changeKeyBtn = document.createElement('button');
        changeKeyBtn.textContent = apiKey ? 'Change API Key' : '⚠ Set API Key';
        changeKeyBtn.title = apiKey ? 'API key is set — click to change' : 'No API key set';
        changeKeyBtn.addEventListener('click', function() {
            const newKey = prompt('Enter your Torn API key (Limited Access or higher):');
            if (newKey && newKey.trim().length >= 10) { setApiKey(newKey.trim()); location.reload(); }
        });

        const historyBtn = document.createElement('button');
        historyBtn.id = 'mine-clear-history-btn';
        historyBtn.textContent = '⚙ History (' + Object.keys(getHistory()).length + ')';
        historyBtn.title = 'View and manage the messaged users database';
        historyBtn.addEventListener('click', openSettingsModal);

        const filtersBtn = document.createElement('button');
        filtersBtn.textContent = '⚙ Filters';
        filtersBtn.title = 'Configure enrichment scoring thresholds';
        filtersBtn.addEventListener('click', openFiltersModal);

        const enrichSettings = getEnrichSettings();
        const enrichToggleBtn = document.createElement('button');
        enrichToggleBtn.id = 'mine-enrich-toggle';
        enrichToggleBtn.textContent = enrichSettings.enabled ? '🔬 Enrichment ON' : '🔬 Enrichment OFF';
        enrichToggleBtn.style.background = enrichSettings.enabled ? 'rgba(58,125,58,0.4)' : 'rgba(255,255,255,0.1)';
        enrichToggleBtn.title = 'Toggle API enrichment scoring';
        enrichToggleBtn.addEventListener('click', function() {
            const s = getEnrichSettings();
            s.enabled = !s.enabled;
            saveEnrichSettings(s);
            enrichToggleBtn.textContent = s.enabled ? '🔬 Enrichment ON' : '🔬 Enrichment OFF';
            enrichToggleBtn.style.background = s.enabled ? 'rgba(58,125,58,0.4)' : 'rgba(255,255,255,0.1)';
        });

        const editMsgBtn = document.createElement('button');
        editMsgBtn.textContent = '✏ Message';
        editMsgBtn.title = 'Edit the recruitment message';
        editMsgBtn.addEventListener('click', openMessageModal);

        header.appendChild(label);
        header.appendChild(changeKeyBtn);
        header.appendChild(historyBtn);
        header.appendChild(filtersBtn);
        header.appendChild(enrichToggleBtn);
        header.appendChild(editMsgBtn);

        const anchor = document.querySelector('.comphelp-widget') || document.querySelector('.content-title');
        if (anchor) anchor.after(header);
        else document.body.prepend(header);

        injectMessageModal();
        injectFiltersModal();
        injectSettingsModal();
    }

    // =========================================================================
    // MAIN
    // =========================================================================
    function init() {
        let apiKey = getApiKey();
        const enrichSettings = getEnrichSettings();
        if (!apiKey && enrichSettings.enabled) apiKey = promptForApiKey();

        const waitTitle = setInterval(function() {
            if (!document.querySelector('.content-title')) return;
            clearInterval(waitTitle);
            injectHeader(apiKey);
        }, 200);

        const waitWrapper = setInterval(function() {
            const wrapper = document.querySelector('.userlist-wrapper');
            if (!wrapper) return;
            clearInterval(waitWrapper);
            processRows(apiKey);
            const observer = new MutationObserver(function() { processRows(apiKey); });
            observer.observe(wrapper, { childList: true, subtree: true });
        }, 300);
    }

    init();

})();
