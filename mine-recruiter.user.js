// ==UserScript==
// @name         Mine Recruiter
// @namespace    MonChoon_
// @version      3.9.0
// @description  Adds recruit buttons to the User Search page. Opens chat and pre-fills recruitment message. Uses Torn HOF API for working stats enrichment with multi-key rotation.
// @license      MIT
// @author       MonChoon [2250591]
// @match        https://www.torn.com/page.php*
// @connect      api.torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @downloadURL  https://github.com/DobrowneyT/torn-userscripts/raw/main/mine-recruiter.js
// @updateURL    https://github.com/DobrowneyT/torn-userscripts/raw/main/mine-recruiter.js
// ==/UserScript==

// CHANGELOG
// 3.9.0 - Use Torn's OWN loader element as the "conversation loaded" signal
//         instead of inferring it. A captured open shows the panel mounting at
//         t=0 already carrying <div class="... loader___ydkxj"> and that
//         element being REMOVED at +454ms once the fetch completes. Waiting for
//         it to disappear is a statement from Torn rather than a guess, and it
//         scales to a long history without tuning. The quiet-period check is
//         kept underneath it, both to catch the final render and to keep
//         working if a future Torn build drops the loader.
// 3.8.0 - Step 2 now waits for the conversation to finish LOADING before the
//         button offers to paste. Torn fetches the whole chat history when a
//         panel opens and re-renders its virtualised list as it arrives; text
//         pasted into that can be wiped by the next render.
//         The signal is deliberately NOT "messages appeared" - a recruitment
//         target has never been messaged, so their conversation is legitimately
//         empty and that test would hang on every single one of them. Instead:
//         the parts must be mounted (scrollWrapper / textarea / send button)
//         and the panel must stop mutating for 400ms. That is true both when a
//         long history finishes arriving and when there is nothing to fetch.
//         Proceeds anyway after 5s rather than abandoning the message.
//         Source is now ASCII-only: every non-ASCII character inside a string
//         is a \uXXXX escape. Torn PDA's webview (and anything else that does
//         not assume UTF-8) decoded the raw bytes as Latin-1, turning every
//         glyph in the UI into mojibake. Escapes decode identically under any
//         charset. Comments keep their real characters - they never render.
// 3.2.0 - Root cause of the "orange button reopens the mini profile" loop:
//         Torn's React root closes the mini profile while the click is still
//         travelling DOWN the DOM, so by the time the event reached our button
//         the chat button was already unmounted. stopPropagation() inside the
//         button's own handler runs too late to help.
//         Fix: one delegated handler on window in the CAPTURE phase, which runs
//         before React's root container sees the event, plus stopPropagation()
//         there so the mini profile is never told to close.
//         Still exactly one user click per game action.
//         Also: step 2 no longer silently falls through to step 1 on failure.
//         API: corrected Torn error code mapping (10 = federal jail,
//         16 = insufficient access level), codes 9/14/17/18 now handled,
//         dead keys are taken out of rotation instead of being retried
//         (Torn warns that repeated invalid-key requests can get the IP banned).
//         Added a 24h working-stats cache and a concurrency limiter for
//         enrichment. Debug logging removed.
// 3.1.0 - Step 1 now WAITS for the mini profile to finish rendering instead of
//         assuming it is instant. Torn's mini profile currently takes ~2.5s to
//         mount its action buttons; the old 300ms reset watchdog fired during
//         that gap and reverted the button to "Recruit" before the chat could
//         be opened. Button is now locked (grey, pointer-events:none) until
//         mini-button2 exists, so it cannot be clicked too early.
//         WAIT_TIMEOUT raised 4000 -> 8000 for the same reason.

(function () {
    'use strict';

    // =========================================================================
    // CONFIG
    // =========================================================================
    const DEFAULT_RECRUIT_MESSAGE =
        "5 Star Mine Hiring 50k+ stats. Great pay, greater perks and rotational Trains." +
        "Pay 20-25x highest stat depending on stats. Message me your stats or Apply here: " +
        "https://www.torn.com/joblist.php#/p=corpinfo&userID=2214797";

    function getRecruitMessage() { return GM_getValue('mine_recruit_message', DEFAULT_RECRUIT_MESSAGE); }
    function setRecruitMessage(msg) { GM_setValue('mine_recruit_message', msg); }
    function RECRUIT_MESSAGE() { return getRecruitMessage(); }

    // Torn's React panels mount slower than they used to. 4000 was too tight.
    const WAIT_TIMEOUT = 8000;
    const WAIT_POLL    = 100;
    // How long step 1 will wait for the mini profile action buttons to render.
    const MINI_RENDER_TIMEOUT = 10000;
    // How long the chat panel must stop mutating before we treat the
    // conversation as loaded, and the cap on waiting for that.
    // Torn's loader was measured at ~450ms for an EMPTY conversation, so the
    // cap has to leave room for a long history on a slow connection.
    const CHAT_LOAD_TIMEOUT  = 8000;
    const CHAT_QUIET_MS      = 300;
    const CHAT_QUIET_TIMEOUT = 5000;

    // =========================================================================
    // ENRICHMENT SETTINGS — min/max working stats only
    // =========================================================================
    const DEFAULT_ENRICH_SETTINGS = { enabled: true, minStats: 0, maxStats: 0 };

    function getEnrichSettings() {
        try {
            const stored = JSON.parse(GM_getValue('mine_enrich_settings', 'null'));
            return Object.assign({}, DEFAULT_ENRICH_SETTINGS, stored || {});
        } catch(e) { return Object.assign({}, DEFAULT_ENRICH_SETTINGS); }
    }
    function saveEnrichSettings(s) { GM_setValue('mine_enrich_settings', JSON.stringify(s)); }

    // =========================================================================
    // MULTI-KEY POOL
    // Each entry: { key, label, status, lastError, disabled }
    // status: 'good' | 'error' | 'expired' | 'unknown'
    // disabled: true once a key fails for a reason that will not fix itself on
    // retry. Torn's docs warn that repeated requests with invalid keys can get
    // your IP temporarily banned, so dead keys must leave the rotation rather
    // than be retried on every row. Use "Test" in the key manager to revive one.
    // =========================================================================
    const KEY_STORE = 'mine_api_keys';

    function getKeyPool() {
        try { return JSON.parse(GM_getValue(KEY_STORE, '[]')); }
        catch(e) { return []; }
    }
    function saveKeyPool(pool) { GM_setValue(KEY_STORE, JSON.stringify(pool)); }

    let _keyIndex = 0;  // session-level pointer into the key pool

    // Returns the next usable key at or after _keyIndex, skipping disabled ones.
    function getActiveKey() {
        const pool = getKeyPool();
        if (pool.length === 0) return null;
        for (let n = 0; n < pool.length; n++) {
            const idx = (_keyIndex + n) % pool.length;
            if (!pool[idx].disabled) { _keyIndex = idx; return pool[idx].key; }
        }
        return null; // every key is disabled
    }

    function advanceKey() {
        const pool = getKeyPool();
        if (pool.length === 0) return null;
        _keyIndex = (_keyIndex + 1) % pool.length;
        return getActiveKey();
    }

    function markKeyStatus(key, status, lastError, disabled) {
        const pool = getKeyPool();
        const entry = pool.find(k => k.key === key);
        if (!entry) return;

        const newDisabled = !!disabled;
        const sameStatus   = entry.status === status;
        const sameError    = lastError === undefined || entry.lastError === lastError;
        const sameDisabled = !!entry.disabled === newDisabled;
        // Nothing changed: skip the GM write and the table rebuild. The old code
        // wrote storage on every single successful request and re-rendered the
        // key table underneath any label you were editing.
        if (sameStatus && sameError && sameDisabled) return;

        entry.status = status;
        if (lastError !== undefined) entry.lastError = lastError;
        entry.disabled = newDisabled;
        saveKeyPool(pool);
        renderKeyTable();
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
            display: inline-flex; align-items: center; padding: 2px 8px;
            font-size: 11px; font-weight: bold; border: none; border-radius: 3px;
            cursor: pointer; white-space: nowrap; line-height: 1.6;
            flex-shrink: 0; transition: background 0.15s;
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
            display: inline-block; font-size: 10px; padding: 1px 5px;
            border-radius: 10px; margin-left: 5px; vertical-align: middle;
            font-weight: bold; flex-shrink: 0;
        }
        .mine-enrich-badge.good    { background: #2e7d32; color: #fff; }
        .mine-enrich-badge.skip    { background: #444;    color: #888; }
        .mine-enrich-badge.loading { background: #333;    color: #777; }

        #mine-recruiter-header {
            display: flex; align-items: center; gap: 10px;
            background: linear-gradient(90deg, #1a3a1a, #2e5c2e);
            color: #fff; font-size: 12px; padding: 5px 10px;
            border-radius: 4px; margin-bottom: 6px;
        }
        #mine-recruiter-header button {
            padding: 2px 8px; font-size: 11px;
            border: 1px solid rgba(255,255,255,0.3);
            background: rgba(255,255,255,0.15);
            color: #fff; border-radius: 3px; cursor: pointer;
        }
        #mine-recruiter-header button:hover { background: rgba(255,255,255,0.25); }

        .userlist-wrapper .level-icons-wrap { display: flex !important; align-items: center; gap: 4px; }
        .userlist-wrapper .level-icons-wrap .user-icons { flex: 1; }

        .mine-overlay {
            display: none; position: fixed; inset: 0;
            background: rgba(0,0,0,0.6); z-index: 999999;
            align-items: center; justify-content: center;
        }
        .mine-overlay.visible { display: flex; }
        .mine-modal {
            background: #1e1e1e; border: 1px solid #444; border-radius: 6px;
            padding: 16px; width: 480px; max-width: 95vw;
            display: flex; flex-direction: column; gap: 10px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.6); color: #eee; font-size: 12px;
        }
        .mine-modal h3 { margin: 0; color: #fff; font-size: 14px; }
        .mine-modal-btns { display: flex; gap: 8px; justify-content: flex-end; }
        .mine-modal-btns button, .mine-settings-btns button {
            padding: 4px 14px; font-size: 12px; border: none;
            border-radius: 3px; cursor: pointer; font-weight: bold;
        }
        .btn-save         { background: #3a7d3a; color: #fff; }
        .btn-save:hover   { background: #2e632e; }
        .btn-danger       { background: #7d1e1e; color: #fff; }
        .btn-danger:hover { background: #5a1515; }
        .btn-neutral       { background: #555; color: #ccc; }
        .btn-neutral:hover { background: #444; }
        .btn-cancel        { background: #333; color: #aaa; }
        .btn-cancel:hover  { background: #2a2a2a; }

        #mine-msg-textarea {
            width: 100%; min-height: 100px; background: #2a2a2a; color: #eee;
            border: 1px solid #555; border-radius: 4px; padding: 8px; font-size: 12px;
            line-height: 1.5; resize: vertical; box-sizing: border-box; font-family: inherit;
        }
        #mine-msg-textarea:focus { outline: none; border-color: #3a7d3a; }

        .mine-settings-section {
            background: #252525; border: 1px solid #383838; border-radius: 4px;
            padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;
        }
        .mine-settings-section h4 {
            margin: 0; color: #bbb; font-size: 11px;
            text-transform: uppercase; letter-spacing: 0.05em;
        }
        .mine-settings-row { display: flex; align-items: center; gap: 10px; }
        .mine-settings-row label { flex: 1; color: #ccc; }
        .mine-settings-row input[type="number"] {
            width: 80px; background: #2a2a2a; color: #eee;
            border: 1px solid #555; border-radius: 3px; padding: 4px 6px; box-sizing: border-box;
        }
        .history-stats { color: #888; font-size: 11px; }
        .mine-settings-btns { display: flex; gap: 8px; justify-content: flex-end; }

        #mine-keys-modal { width: 600px; }
        .mine-key-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .mine-key-table th {
            background: #2a2a2a; color: #aaa; font-weight: bold;
            padding: 6px 8px; border-bottom: 1px solid #444; text-align: left;
        }
        .mine-key-table td { padding: 5px 8px; border-bottom: 1px solid #2e2e2e; vertical-align: middle; }
        .mine-key-table tr:hover td { background: #252525; }
        .key-status-good    { color: #4caf50; font-weight: bold; }
        .key-status-error   { color: #f44336; font-weight: bold; }
        .key-status-expired { color: #ff9800; font-weight: bold; }
        .key-status-unknown { color: #888; }
        .key-masked { font-family: monospace; color: #999; letter-spacing: 0.05em; }
        .mine-key-add-row { display: flex; gap: 6px; align-items: center; }
        .mine-key-add-row input {
            background: #2a2a2a; color: #eee; border: 1px solid #555;
            border-radius: 3px; padding: 5px 8px; font-size: 11px; box-sizing: border-box;
        }
        .mine-key-add-row input:focus { outline: none; border-color: #3a7d3a; }
        .btn-sm { padding: 2px 7px; font-size: 10px; border: none; border-radius: 3px; cursor: pointer; font-weight: bold; }
        .btn-sm-danger  { background: #5a1515; color: #f99; }
        .btn-sm-danger:hover { background: #7d1e1e; }
        .btn-sm-up   { background: #1a3a1a; color: #9f9; }
        .btn-sm-down { background: #1a1a3a; color: #99f; }
        .btn-sm-test { background: #1a2a3a; color: #9cf; }
        .label-input {
            background: #1e1e1e; color: #ccc; border: 1px solid #333;
            border-radius: 3px; padding: 2px 6px; font-size: 11px;
            width: 100%; box-sizing: border-box;
        }
        .label-input:focus { outline: none; border-color: #3a7d3a; }
    `;
    document.head.appendChild(style);

    // =========================================================================
    // RESILIENT CHAT ELEMENT FINDERS
    // =========================================================================
    function findChatTextarea(panel) { return panel ? panel.querySelector('textarea') : null; }
    function findSendButton(panel) {
        if (!panel) return null;
        const b = panel.querySelector('[class*="iconWrapper"]'); if (b) return b;
        const ta = panel.querySelector('textarea');
        return (ta && ta.parentElement) ? ta.parentElement.querySelector('button') : null;
    }
    function findCloseButton(panel) {
        if (!panel) return null;
        return panel.querySelector('[class*="closeIcon"]') || panel.querySelector('[aria-label="Close"][tabindex]');
    }

    // Mini profile chat button. Kept in one place so a future Torn rename is a
    // one-line change instead of a hunt through the state machine.
    function findMiniChatBtn(userId) {
        return document.getElementById('mini-button2-profile-' + userId)
            || document.querySelector('[id^="mini-button"][id$="-profile-' + userId + '"][class*="initiateChat"]')
            || null;
    }

    // =========================================================================
    // REACT TEXTAREA HACK
    // =========================================================================
    function setReactTextareaValue(textarea, value) {
        const ns = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        ns.call(textarea, value);
        textarea.dispatchEvent(new Event('input',  { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // =========================================================================
    // WAIT UTILITIES
    // =========================================================================
    function waitFor(fn, timeout, root) {
        timeout = timeout || WAIT_TIMEOUT; root = root || document;
        return new Promise(function(resolve, reject) {
            const start = Date.now();
            function tick() {
                const el = typeof fn === 'function' ? fn() : root.querySelector(fn);
                if (el) return resolve(el);
                if (Date.now() - start > timeout) return reject(new Error('Timeout'));
                setTimeout(tick, WAIT_POLL);
            }
            tick();
        });
    }

    function waitForSendButton(panel, timeout) {
        timeout = timeout || 3000;
        return new Promise(function(resolve, reject) {
            const start = Date.now();
            function tick() {
                const btn = findSendButton(panel);
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
        const t = document.getElementById('torn-user');
        if (t) { try { return JSON.parse(t.value).id; } catch(e) {} }
        const w = document.getElementById('websocketConnectionData');
        if (w) { try { return JSON.parse(w.value || w.textContent).userID; } catch(e) {} }
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
                for (let i = 0; i < panels.length; i++) { if (panels[i].id.includes(userId)) return resolve(panels[i]); }
                if (Date.now() - start > WAIT_TIMEOUT) return reject(new Error('Panel did not open'));
                setTimeout(tick, WAIT_POLL);
            }
            tick();
        });
    }

    function getChatPanel(userId) {
        const myId = getMyUserId();
        if (myId) {
            const a = document.getElementById('private-' + myId + '-' + userId); if (a) return a;
            const b = document.getElementById('private-' + userId + '-' + myId); if (b) return b;
        }
        const panels = document.querySelectorAll('div[id^="private-"]');
        for (let i = 0; i < panels.length; i++) { if (panels[i].id.includes(userId)) return panels[i]; }
        return null;
    }

    function closeChatPanel(panel, userId) {
        if (!panel) return;
        const cb = findCloseButton(panel);
        if (cb) { cb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return; }
        const myId = getMyUserId();
        if (myId) {
            const t1 = document.getElementById('channel_panel_button:private-' + myId + '-' + userId);
            if (t1) { t1.click(); return; }
            const t2 = document.getElementById('channel_panel_button:private-' + userId + '-' + myId);
            if (t2) t2.click();
        }
    }

    // =========================================================================
    // CHAT READY  (is the conversation done loading?)
    // =========================================================================

    /**
     * Are the parts of the chat panel we need mounted?
     *
     * ⚠️ Deliberately NOT "are there messages". A recruitment target has never
     * been messaged before, so their conversation is legitimately EMPTY — a
     * freshly opened panel carries only a topSentinel and a footer, with the
     * list container at height:10px. Waiting for message rows would hang on
     * exactly the users this script exists for, and time out on every one.
     *
     * So the positive signal is only that the pieces exist. Whether history
     * arrives is left to the quiet period below.
     */
    function chatPanelParts(panel) {
        if (!panel) return null;
        const scroll   = panel.querySelector('[class*="scrollWrapper___"]');
        const textarea = panel.querySelector('textarea');
        const send     = panel.querySelector('[class*="iconWrapper"]');
        return (scroll && textarea && send) ? { scroll, textarea, send } : null;
    }

    /**
     * Resolve once the panel has stopped changing for `quietMs`.
     *
     * Torn fetches the whole conversation when a chat opens and re-renders its
     * virtualised list as the history arrives. Pasting into that is how a
     * message gets silently wiped by the next render. Rather than hunt for a
     * "loaded" marker among hashed class names that rotate every deploy, this
     * waits for the DOM to go QUIET — which is true both when a long history
     * finishes arriving and when there is no history at all, with no special
     * case for either.
     *
     * Resolves false if the cap is reached and the caller proceeds anyway: a
     * chat that never settles is still better pasted into than abandoned.
     */
    function waitForChatQuiet(panel, quietMs, timeout) {
        quietMs = quietMs || CHAT_QUIET_MS;
        timeout = timeout || CHAT_QUIET_TIMEOUT;
        return new Promise(function (resolve) {
            if (!panel) return resolve(false);
            let quietTimer = null;
            let capTimer = null;
            const obs = new MutationObserver(armQuiet);
            function finish(settled) {
                obs.disconnect();
                clearTimeout(quietTimer);
                clearTimeout(capTimer);
                resolve(settled);
            }
            function armQuiet() {
                clearTimeout(quietTimer);
                quietTimer = setTimeout(function () { finish(true); }, quietMs);
            }
            obs.observe(panel, { childList: true, subtree: true, characterData: true });
            capTimer = setTimeout(function () { finish(false); }, timeout);
            armQuiet();
        });
    }

    /**
     * Torn's own "fetching the conversation" spinner, if it is still up.
     *
     * Captured from a real open (see CHANGELOG 3.9.0): the panel mounts at t=0
     * already carrying
     *
     *     <div class="root___lC8Pu loader___ydkxj" style="--dot-count: 8;">
     *
     * and that element is REMOVED once the history has arrived — at +454ms for
     * an empty conversation, later for one with messages. It is an explicit
     * statement from Torn that the fetch is done, which beats any amount of
     * inferring from node counts or heights.
     *
     * Matched on the `loader___` prefix, not the full hash: `___ydkxj` rotates
     * on every Torn deploy, exactly like every other class in this panel.
     */
    function chatLoader(panel) {
        return panel ? panel.querySelector('[class*="loader___"]') : null;
    }

    /** Mounted, fetched, and settled. Returns the panel so callers can chain. */
    async function waitForChatReady(panel, userId) {
        await waitFor(function () { return chatPanelParts(panel); }, WAIT_TIMEOUT);

        // The real signal, when Torn gives us one.
        if (chatLoader(panel)) {
            try {
                await waitFor(function () { return !chatLoader(panel); }, CHAT_LOAD_TIMEOUT);
            } catch (e) {
                console.warn('[Mine Recruiter] chat for ' + userId + ' still loading after '
                    + CHAT_LOAD_TIMEOUT + 'ms; pasting anyway');
            }
        }

        // Belt and braces: the loader going away is the fetch finishing, not
        // necessarily the last render landing. A short quiet period covers that,
        // and covers a future Torn build that drops the loader entirely — in
        // which case this is the whole check rather than a top-up.
        const settled = await waitForChatQuiet(panel);
        if (!settled) {
            console.warn('[Mine Recruiter] chat for ' + userId
                + ' never went quiet within ' + CHAT_QUIET_TIMEOUT + 'ms; pasting anyway');
        }
        return panel;
    }

    // =========================================================================
    // MESSAGED HISTORY
    // =========================================================================
    function getHistory() { try { return JSON.parse(GM_getValue('mine_messaged_history', '{}')); } catch(e) { return {}; } }
    function saveHistory(h) { GM_setValue('mine_messaged_history', JSON.stringify(h)); }
    function markMessaged(uid) { const h = getHistory(); h[uid] = Date.now(); saveHistory(h); }
    function wasMessaged(uid) { return !!getHistory()[uid]; }
    function getMessagedDate(uid) { const ts = getHistory()[uid]; return ts ? new Date(ts) : null; }
    function clearHistoryOlderThan(days) {
        const h = getHistory(); const now = Date.now(); let removed = 0;
        if (days <= 0) { removed = Object.keys(h).length; saveHistory({}); }
        else { const c = days * 86400000; for (const uid in h) { if (now - h[uid] >= c) { delete h[uid]; removed++; } } saveHistory(h); }
        return removed;
    }
    function getHistoryStats() {
        const h = getHistory(); const now = Date.now(); const entries = Object.entries(h); const total = entries.length;
        if (!total) return { total: 0, oldestDays: null, newestDays: null };
        const ts = entries.map(([,t]) => t).sort((a,b) => a-b);
        return { total, oldestDays: Math.floor((now - ts[0]) / 86400000), newestDays: Math.floor((now - ts[ts.length-1]) / 86400000) };
    }

    // =========================================================================
    // TORN API ERROR CODES
    // Reference list, previously mis-mapped in this script: 16 is NOT federal
    // jail, it is an insufficient access level. 10 is the jail one.
    //   FATAL     - this key will not work again without owner action.
    //               Rotate away AND take it out of rotation.
    //   TRANSIENT - this key may work later. Rotate away, keep it in the pool.
    //   Anything else is a server-side or request-side problem that another key
    //   will not solve, so fail the row without blaming the key.
    // =========================================================================
    const KEY_FATAL = {
        2:  'Incorrect API key',
        10: 'Key owner is in federal jail',
        13: 'Key owner inactive for 7+ days',
        16: 'Key access level too low',
        18: 'API key paused by owner'
    };
    const KEY_TRANSIENT = {
        5:  'Too many requests (rate limited)',
        8:  'IP block',
        14: 'Daily read limit reached'
    };

    // =========================================================================
    // WORKING STATS CACHE (24h)
    // Working stats barely move, so refetching every user on every page view is
    // pure waste against a 100 req/min budget.
    // =========================================================================
    const STATS_STORE = 'mine_stats_cache';
    const STATS_TTL   = 24 * 60 * 60 * 1000;

    let _statsCache = null;
    let _statsFlushTimer = null;

    function getStatsCache() {
        if (_statsCache) return _statsCache;
        try { _statsCache = JSON.parse(GM_getValue(STATS_STORE, '{}')) || {}; }
        catch(e) { _statsCache = {}; }
        return _statsCache;
    }

    function pruneStatsCache() {
        const c = getStatsCache(); const now = Date.now();
        for (const uid in c) { if (!c[uid] || now - c[uid].ts > STATS_TTL) delete c[uid]; }
        return c;
    }

    function scheduleStatsFlush() {
        if (_statsFlushTimer) return;
        _statsFlushTimer = setTimeout(() => {
            _statsFlushTimer = null;
            GM_setValue(STATS_STORE, JSON.stringify(pruneStatsCache()));
        }, 2000);
    }

    // undefined = miss. null = cached "no working stats in HOF".
    function cachedStats(uid) {
        const c = getStatsCache(); const e = c[uid];
        if (!e) return undefined;
        if (Date.now() - e.ts > STATS_TTL) { delete c[uid]; return undefined; }
        return e.v;
    }
    function setCachedStats(uid, v) {
        getStatsCache()[uid] = { v: v, ts: Date.now() };
        scheduleStatsFlush();
    }
    function clearStatsCache() {
        const n = Object.keys(getStatsCache()).length;
        _statsCache = {};
        GM_setValue(STATS_STORE, '{}');
        return n;
    }

    // =========================================================================
    // API — HOF working stats with multi-key rotation
    // =========================================================================
    function apiGet(url, keyUsed) {
        return new Promise(function(resolve, reject) {
            GM_xmlhttpRequest({
                method: 'GET', url,
                headers: { 'Content-Type': 'application/json' },
                onload: function(res) {
                    try {
                        const data = JSON.parse(res.responseText);
                        if (data.error) {
                            const code = data.error.code || 0;
                            return reject({
                                code: code,
                                key: keyUsed,
                                msg: KEY_FATAL[code] || KEY_TRANSIENT[code] || data.error.error || ('API error ' + code)
                            });
                        }
                        resolve(data);
                    } catch(e) { reject({ code: -1, msg: 'Parse error: ' + e.message }); }
                },
                onerror: function(err) { reject({ code: -1, msg: 'Network error: ' + String(err) }); }
            });
        });
    }

    async function fetchWorkingStats(userId) {
        const pool = getKeyPool();
        if (!pool.length) throw new Error('No API keys configured');

        let attempts = 0;
        while (attempts < pool.length) {
            const key = getActiveKey();
            if (!key) throw new Error('All API keys are disabled \u2014 test them in the key manager');
            try {
                const data = await apiGet('https://api.torn.com/v2/user/' + userId + '/hof?key=' + key, key);
                markKeyStatus(key, 'good', '', false);
                return (data.hof && data.hof.working_stats) ? data.hof.working_stats.value : null;
            } catch(err) {
                const code = err.code;
                if (KEY_FATAL[code]) {
                    // 10/13/18 are owner-side and may resolve; 2/16 are the key
                    // itself being wrong. Both leave rotation until re-tested.
                    markKeyStatus(key, (code === 2 || code === 16) ? 'error' : 'expired', err.msg, true);
                    advanceKey(); attempts++;
                } else if (KEY_TRANSIENT[code]) {
                    markKeyStatus(key, 'error', err.msg, false);
                    advanceKey(); attempts++;
                } else {
                    // 9 (API disabled), 15, 17 (backend) and anything unknown:
                    // not this key's fault, another key will not help.
                    throw new Error(err.msg || 'Unknown error');
                }
            }
        }
        throw new Error('All API keys exhausted');
    }

    function testKey(key) {
        return new Promise(function(resolve) {
            GM_xmlhttpRequest({
                method: 'GET', url: 'https://api.torn.com/v2/user/hof?key=' + key,
                headers: { 'Content-Type': 'application/json' },
                onload: function(res) {
                    try {
                        const d = JSON.parse(res.responseText);
                        if (d.error) {
                            const c = d.error.code || 0;
                            if (KEY_FATAL[c]) {
                                return resolve({
                                    status: (c === 2 || c === 16) ? 'error' : 'expired',
                                    msg: KEY_FATAL[c], disabled: true
                                });
                            }
                            if (KEY_TRANSIENT[c]) return resolve({ status: 'error', msg: KEY_TRANSIENT[c], disabled: false });
                            return resolve({ status: 'error', msg: d.error.error || ('Error ' + c), disabled: false });
                        }
                        resolve({ status: 'good', msg: '', disabled: false });
                    } catch(e) { resolve({ status: 'error', msg: 'Parse error', disabled: false }); }
                },
                onerror: function() { resolve({ status: 'error', msg: 'Network error', disabled: false }); }
            });
        });
    }

    function formatStats(n) {
        if (!n) return '0';
        if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'b';
        if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'm';
        if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'k';
        return n.toLocaleString();
    }

    // =========================================================================
    // ENRICHMENT — HOF working stats filter
    // =========================================================================
    async function enrichRow(row, userId) {
        const settings = getEnrichSettings();
        if (!settings.enabled || !getKeyPool().length) return;

        const levelSpan = row.querySelector('.level');
        const anchor = levelSpan || row.querySelector('.level-icons-wrap');
        if (!anchor) return; // nowhere to show a badge, so don't spend an API call
        const badge = document.createElement('span');
        badge.className = 'mine-enrich-badge loading'; badge.textContent = '\u2026';
        if (levelSpan) levelSpan.after(badge); else anchor.appendChild(badge);
        const btn = row.querySelector('.mine-recruit-btn');

        const paint = (ws, fromCache) => {
            if (ws === null) {
                badge.className = 'mine-enrich-badge skip';
                badge.textContent = 'N/A'; badge.title = 'No working stats in HOF'; return;
            }
            const display = formatStats(ws);
            const minOk = !settings.minStats || ws >= settings.minStats;
            const maxOk = !settings.maxStats || ws <= settings.maxStats;
            const suffix = fromCache ? ' (cached)' : '';
            if (minOk && maxOk) {
                badge.className = 'mine-enrich-badge good';
                badge.textContent = display; badge.title = 'Working stats: ' + ws.toLocaleString() + suffix;
            } else {
                badge.className = 'mine-enrich-badge skip';
                badge.textContent = display;
                badge.title = 'Working stats: ' + ws.toLocaleString() +
                    (!minOk ? ' (below min ' + formatStats(settings.minStats) + ')' : ' (above max ' + formatStats(settings.maxStats) + ')') + suffix;
                if (btn && btn.className.includes('ready')) {
                    btn.className = 'mine-recruit-btn skip'; btn.textContent = '\u2717 Skip'; btn.title = badge.title;
                }
            }
        };

        const hit = cachedStats(userId);
        if (hit !== undefined) { paint(hit, true); return; }

        try {
            const ws = await fetchWorkingStats(userId);
            setCachedStats(userId, ws);
            paint(ws, false);
        } catch(err) {
            badge.className = 'mine-enrich-badge skip'; badge.textContent = 'err';
            badge.title = String(err.message || err);
            console.warn('[Mine Recruiter] Enrichment failed for ' + userId + ':', err);
        }
    }

    // =========================================================================
    // ENRICHMENT QUEUE
    // Torn allows 100 requests per minute per USER across all of that user's
    // keys, so firing one request per row in parallel is the fastest way to
    // rate-limit yourself. Two at a time with spacing is plenty.
    // =========================================================================
    const ENRICH_CONCURRENCY = 2;
    const ENRICH_SPACING     = 400;
    const _enrichQueue = [];
    let _enrichActive = 0;

    function queueEnrich(task) { _enrichQueue.push(task); pumpEnrich(); }

    function pumpEnrich() {
        if (_enrichActive >= ENRICH_CONCURRENCY) return;
        const task = _enrichQueue.shift();
        if (!task) return;
        _enrichActive++;
        Promise.resolve()
            .then(task)
            .catch(e => console.warn('[Mine Recruiter] enrich task failed:', e))
            .then(() => {
                setTimeout(() => { _enrichActive--; pumpEnrich(); }, ENRICH_SPACING);
            });
    }

    // =========================================================================
    // PER-USER STATE MACHINE
    // idle → mini_open → chat_open → pasted → sent → idle
    // =========================================================================
    const recruitState = {};

    async function openChatAndFill(userId, btn) {
        try {
            const myId = getMyUserId();
            if (!myId) throw new Error('Could not determine your user ID');
            const state = recruitState[userId] || 'idle';

            if (state === 'sent') {
                const p = getChatPanel(userId); if (p) closeChatPanel(p, userId);
                markMessaged(userId); recruitState[userId] = 'idle';
                btn.className = 'mine-recruit-btn skip'; btn.style.background = '#2e632e';
                btn.textContent = '\u2713 Messaged'; btn.title = 'Messaged ' + new Date().toLocaleDateString();
                refreshHeaderCount(); return;
            }

            if (state === 'pasted') {
                const p = getChatPanel(userId);
                if (!p) { markMessaged(userId); recruitState[userId] = 'idle'; btn.className = 'mine-recruit-btn skip'; btn.style.background = '#2e632e'; btn.textContent = '\u2713 Messaged'; refreshHeaderCount(); return; }
                btn.className = 'mine-recruit-btn loading'; btn.textContent = '\u23F3 Sending...';
                try {
                    const sb = await waitForSendButton(p, 3000); sb.click();
                } catch(e) {
                    const ta = findChatTextarea(p);
                    if (ta) {
                        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                        ta.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                    }
                }
                recruitState[userId] = 'sent'; btn.className = 'mine-recruit-btn action'; btn.style.background = '';
                btn.textContent = '\u2705 Click to close & save'; return;
            }

            if (state === 'chat_open') {
                const p = getChatPanel(userId);
                const ta = findChatTextarea(p);
                navigator.clipboard.writeText(RECRUIT_MESSAGE()).catch(function() {});
                if (ta) {
                    ta.focus(); setReactTextareaValue(ta, RECRUIT_MESSAGE());
                    recruitState[userId] = 'pasted'; btn.className = 'mine-recruit-btn send-ready'; btn.style.background = '';
                    btn.textContent = '\uD83D\uDCE8 Click to send';
                } else {
                    recruitState[userId] = 'pasted'; btn.className = 'mine-recruit-btn warn'; btn.style.background = '';
                    btn.textContent = '\uD83D\uDCCB Copied \u2014 paste manually then click send';
                }
                return;
            }

            // Tray fast path
            const trayBtn = document.getElementById('channel_panel_button:private-' + myId + '-' + userId);
            if (trayBtn && recruitState[userId] !== 'mini_open') {
                btn.className = 'mine-recruit-btn loading'; btn.textContent = '\u23F3 Opening...';
                trayBtn.click();
                const p = await waitForChatPanel(userId);
                await waitForChatReady(p, userId);
                recruitState[userId] = 'chat_open'; btn.className = 'mine-recruit-btn action'; btn.style.background = '';
                btn.textContent = '\u26CF Click to paste message'; return;
            }

            // Click 2 — open chat from mini-profile
            const miniChatBtn = findMiniChatBtn(userId);
            if (miniChatBtn) {
                if (!miniChatBtn.classList.contains('active')) {
                    markMessaged(userId); recruitState[userId] = 'idle';
                    btn.className = 'mine-recruit-btn skip'; btn.style.background = '#2e632e';
                    btn.textContent = '\u2713 Skipped (chat blocked)'; refreshHeaderCount(); return;
                }
                btn.className = 'mine-recruit-btn loading'; btn.textContent = '\u23F3 Opening chat...';
                const rec = recordDomAdditions();
                miniChatBtn.click();
                let p;
                try { p = await waitForChatPanel(userId); }
                catch (e) { dumpChatDiagnostics(userId, rec.stop()); throw e; }
                rec.stop();
                await waitForChatReady(p, userId);
                recruitState[userId] = 'chat_open'; btn.className = 'mine-recruit-btn action'; btn.style.background = '';
                btn.textContent = '\u26CF Click to paste message'; return;
            }

            // Step 2 failed: the mini profile is gone. Do NOT fall through to
            // step 1, that produces a confusing silent reopen loop.
            if (state === 'mini_open') {
                recruitState[userId] = 'idle';
                btn.className = 'mine-recruit-btn warn'; btn.style.background = '';
                btn.textContent = '\u26A0 Profile closed \u2014 click to retry';
                console.warn('[Mine Recruiter] mini chat button vanished before step 2 for ' + userId);
                return;
            }

            // Click 1 — open mini-profile
            const row = document.querySelector('li.user' + userId) || document.querySelector('li[class*="user' + userId + '"]');
            if (!row) throw new Error('Row not found');
            const nameLink = row.querySelector('a.user.name') || row.querySelector('a[href*="profiles.php?XID=' + userId + '"]');
            if (!nameLink) throw new Error('Name link not found');

            const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            const jq = uw.jQuery || uw.$;
            if (!jq) throw new Error('jQuery not found');

            const suppressMouseup = e => e.stopImmediatePropagation();
            nameLink.addEventListener('mouseup',  suppressMouseup, true);
            nameLink.addEventListener('touchend', suppressMouseup, true);
            setTimeout(() => { nameLink.removeEventListener('mouseup', suppressMouseup, true); nameLink.removeEventListener('touchend', suppressMouseup, true); }, 650);

            let capturedNativeEvent = null;
            const captureAndStop = e => { capturedNativeEvent = e; e.stopImmediatePropagation(); };
            nameLink.addEventListener('mousedown', captureAndStop, true);
            const rect = nameLink.getBoundingClientRect();
            nameLink.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
            nameLink.removeEventListener('mousedown', captureAndStop, true);

            const jqEvent = jq.Event('mousedown', { which: 1, button: 0 });
            jqEvent.originalEvent = capturedNativeEvent;
            jq(nameLink).trigger(jqEvent);

            recruitState[userId] = 'mini_open';

            // --- WAIT FOR THE MINI PROFILE TO ACTUALLY RENDER -----------------
            // Torn currently takes ~2.5s to mount the profile-button row. The
            // button is locked (.loading has pointer-events:none) so it cannot
            // be clicked before step 2 would actually work.
            btn.className = 'mine-recruit-btn loading';
            btn.style.background = '';
            btn.textContent = '\u23F3 Loading profile...';

            try {
                await waitFor(() => findMiniChatBtn(userId), MINI_RENDER_TIMEOUT);
            } catch (e) {
                recruitState[userId] = 'idle';
                btn.className = 'mine-recruit-btn warn'; btn.style.background = '';
                btn.textContent = '\u26A0 Profile did not load \u2014 click to retry';
                btn.title = 'Mini profile chat button never rendered within ' + MINI_RENDER_TIMEOUT + 'ms';
                console.warn('[Mine Recruiter] mini chat button never rendered for ' + userId);
                return;
            }

            btn.className = 'mine-recruit-btn ready';
            btn.style.background = '#7b4a00';
            btn.textContent = '\u26CF Click to open chat';
            btn.title = 'Open chat (step 2 of 5)';

            // --- WATCHDOG: only now start watching for the mini profile CLOSING.
            // Requires 3 consecutive misses so a React re-render blip does not
            // reset the state machine.
            let misses = 0;
            const resetWatch = setInterval(() => {
                if (findMiniChatBtn(userId)) { misses = 0; return; }
                if (++misses < 3) return;
                clearInterval(resetWatch);
                if (recruitState[userId] === 'mini_open') {
                    recruitState[userId] = 'idle';
                    btn.className = 'mine-recruit-btn ready'; btn.style.background = '';
                    btn.textContent = '\u26CF Recruit'; btn.title = 'Open mini-profile (step 1 of 5)';
                }
            }, 300);
            setTimeout(() => clearInterval(resetWatch), 60000);

        } catch(err) {
            console.warn('[Mine Recruiter] Error:', err.message);
            recruitState[userId] = 'idle'; btn.className = 'mine-recruit-btn ready'; btn.style.background = ''; btn.textContent = '\u26CF Recruit';
            clipboardFallback(btn);
        }
    }

    function clipboardFallback(btn) {
        navigator.clipboard.writeText(RECRUIT_MESSAGE()).then(() => {
            btn.className = 'mine-recruit-btn sent'; btn.textContent = '\uD83D\uDCCB Copied \u2014 open chat manually';
            setTimeout(() => { btn.className = 'mine-recruit-btn ready'; btn.textContent = '\u26CF Recruit'; }, 5000);
        }).catch(() => { btn.className = 'mine-recruit-btn ready'; btn.textContent = '\u26CF Recruit'; alert('[Mine Recruiter] Could not copy to clipboard.'); });
    }

    // =========================================================================
    // BUILD BUTTON & PROCESS ROWS
    // =========================================================================
    function buildButton(userId) {
        const btn = document.createElement('button');
        if (wasMessaged(userId)) {
            const d = getMessagedDate(userId);
            const daysAgo = d ? Math.floor((Date.now() - d.getTime()) / 86400000) : '?';
            btn.className = 'mine-recruit-btn skip'; btn.style.background = '#2e632e'; btn.textContent = '\u2713 Messaged';
            btn.title = d ? 'Messaged ' + d.toLocaleDateString() + ' (' + daysAgo + 'd ago)' : 'Previously messaged';
        } else {
            btn.className = 'mine-recruit-btn ready'; btn.textContent = '\u26CF Recruit'; btn.title = 'Open mini-profile (step 1 of 5)';
            // No per-button listener. Clicks are handled by the delegated
            // capture-phase handler below, which must run before React's root.
        }
        return btn;
    }

    // =========================================================================
    // DELEGATED CAPTURE-PHASE CLICK HANDLER
    // Torn's React root unmounts the mini profile while a click is still
    // travelling down the DOM. A listener on the button itself therefore fires
    // AFTER the chat button has already been removed. Listening on window in
    // the capture phase puts us first in the chain, and stopPropagation() here
    // means React never sees the event at all, so the profile stays open.
    // One physical click still maps to exactly one game action.
    // =========================================================================
    function installDelegatedClickHandler() {
        ['pointerdown', 'mousedown', 'click'].forEach(type => {
            window.addEventListener(type, function (e) {
                const btn = (e.target && e.target.closest) ? e.target.closest('.mine-recruit-btn') : null;
                if (!btn) return;

                // Our button, our event. Keep it away from Torn entirely.
                e.stopPropagation();
                if (type === 'click') e.preventDefault();

                if (type !== 'click') return;
                if (btn.classList.contains('loading') || btn.classList.contains('skip')) return;

                const li = btn.closest('li[class*="user"]');
                const m = li && li.className.match(/\buser(\d+)\b/);
                if (!m) { console.warn('[Mine Recruiter] could not resolve user id from row'); return; }

                openChatAndFill(m[1], btn);
            }, true);
        });
    }

    function processRows() {
        const settings = getEnrichSettings();
        document.querySelectorAll('.userlist-wrapper .user-info-list-wrap > li[class*="user"]').forEach(row => {
            const m = row.className.match(/\buser(\d+)\b/); if (!m) return;
            const userId = m[1];
            if (row.querySelector('.mine-recruit-btn')) return;
            const iconsWrap = row.querySelector('.level-icons-wrap'); if (!iconsWrap) return;
            iconsWrap.appendChild(buildButton(userId));
            if (settings.enabled && getKeyPool().length > 0) queueEnrich(() => enrichRow(row, userId));
        });
    }

    // =========================================================================
    // HEADER HELPERS
    // =========================================================================
    function refreshHeaderCount() {
        const hb = document.getElementById('mine-clear-history-btn');
        if (hb) hb.textContent = 'History (' + Object.keys(getHistory()).length + ')';
        const kb = document.getElementById('mine-key-mgr-btn');
        if (kb) kb.textContent = 'Keys (' + getKeyPool().length + ')';
    }

    function refreshButtons() {
        document.querySelectorAll('.mine-recruit-btn.skip').forEach(btn => {
            if (!btn.textContent.includes('Messaged')) return;
            const li = btn.closest('li[class*="user"]'); if (!li) return;
            const m = li.className.match(/\buser(\d+)\b/); if (!m) return;
            const uid = m[1];
            if (!wasMessaged(uid)) {
                recruitState[uid] = 'idle';
                const fresh = btn.cloneNode(true); btn.replaceWith(fresh);
                fresh.className = 'mine-recruit-btn ready'; fresh.style.background = '';
                fresh.textContent = '\u26CF Recruit'; fresh.title = 'Open mini-profile (step 1 of 5)';
                // Delegated handler picks this up, no rebinding needed.
            }
        });
    }

    // =========================================================================
    // KEY MANAGER MODAL
    // =========================================================================
    function maskKey(key) {
        if (!key || key.length < 8) return key;
        return key.slice(0, 4) + '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + key.slice(-4);
    }

    function statusHTML(entry) {
        const status = entry.status;
        const msg = entry.lastError;
        const cls = 'key-status-' + (status || 'unknown');
        const label = { good: '\u2713 Good', error: '\u2717 Error', expired: '\u26A0 Jailed/Expired', unknown: '? Unknown' }[status] || '? Unknown';
        const outOf = entry.disabled ? ' <span style="color:#f44336;font-size:10px;">(out of rotation)</span>' : '';
        return '<span class="' + cls + '"' + (msg ? ' title="' + String(msg).replace(/"/g, '&quot;') + '"' : '') + '>' + label + '</span>' + outOf;
    }

    function renderKeyTable() {
        const tbody = document.getElementById('mine-key-tbody'); if (!tbody) return;
        const pool = getKeyPool();
        if (!pool.length) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#666;padding:12px;">No keys yet. Add one below.</td></tr>';
        } else {
            tbody.innerHTML = pool.map((entry, i) =>
                '<tr>' +
                '<td style="text-align:center;color:#666;width:28px;">' + (i + 1) + '</td>' +
                '<td><input class="label-input" data-idx="' + i + '" value="' + (entry.label||'').replace(/"/g,'&quot;') + '" placeholder="Label\u2026"></td>' +
                '<td class="key-masked">' + maskKey(entry.key) + '</td>' +
                '<td>' + statusHTML(entry) + '</td>' +
                '<td style="white-space:nowrap;display:flex;gap:3px;">' +
                    (i > 0 ? '<button class="btn-sm btn-sm-up" data-action="up" data-idx="' + i + '" title="Move up">&#9650;</button>' : '') +
                    (i < pool.length - 1 ? '<button class="btn-sm btn-sm-down" data-action="down" data-idx="' + i + '" title="Move down">&#9660;</button>' : '') +
                    '<button class="btn-sm btn-sm-test" data-action="test" data-idx="' + i + '">Test</button>' +
                    '<button class="btn-sm btn-sm-danger" data-action="delete" data-idx="' + i + '" title="Remove">\u2715</button>' +
                '</td></tr>'
            ).join('');
        }

        tbody.querySelectorAll('.label-input').forEach(inp => {
            inp.addEventListener('change', function() {
                const p = getKeyPool(); p[parseInt(this.dataset.idx)].label = this.value.trim(); saveKeyPool(p);
            });
        });

        tbody.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', function() {
                const action = this.dataset.action; const idx = parseInt(this.dataset.idx); const pool = getKeyPool();
                if (action === 'delete') {
                    if (confirm('Remove key ' + maskKey(pool[idx].key) + '?')) { pool.splice(idx, 1); saveKeyPool(pool); renderKeyTable(); refreshHeaderCount(); }
                } else if (action === 'up' && idx > 0) {
                    [pool[idx-1], pool[idx]] = [pool[idx], pool[idx-1]]; saveKeyPool(pool); renderKeyTable();
                } else if (action === 'down' && idx < pool.length - 1) {
                    [pool[idx], pool[idx+1]] = [pool[idx+1], pool[idx]]; saveKeyPool(pool); renderKeyTable();
                } else if (action === 'test') {
                    const key = pool[idx].key; btn.textContent = '\u2026'; btn.disabled = true;
                    testKey(key).then(result => {
                        const p = getKeyPool(); const e = p.find(k => k.key === key);
                        if (e) {
                            e.status = result.status;
                            e.lastError = result.msg;
                            e.disabled = !!result.disabled;   // a passing test puts the key back in rotation
                            saveKeyPool(p);
                        }
                        renderKeyTable();
                    });
                }
            });
        });

        const countEl = document.getElementById('mine-key-count');
        if (countEl) countEl.textContent = pool.length + ' key' + (pool.length !== 1 ? 's' : '') + ' configured';
    }

    function injectKeyManagerModal() {
        if (document.getElementById('mine-keys-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'mine-keys-overlay'; overlay.className = 'mine-overlay';
        overlay.innerHTML = `
            <div class="mine-modal" id="mine-keys-modal">
                <h3>&#128273; API Key Manager</h3>
                <div style="color:#888;font-size:11px;">
                    Keys rotate automatically on rate-limit (wraps around). Requires <b>Public Access</b> or higher.
                </div>
                <div id="mine-key-count" style="color:#aaa;font-size:11px;"></div>
                <div style="overflow-x:auto;max-height:280px;overflow-y:auto;">
                    <table class="mine-key-table">
                        <thead><tr>
                            <th style="width:28px;">#</th>
                            <th style="width:110px;">Label</th>
                            <th>Key</th>
                            <th style="width:130px;">Status</th>
                            <th style="width:110px;">Actions</th>
                        </tr></thead>
                        <tbody id="mine-key-tbody"></tbody>
                    </table>
                </div>
                <div style="color:#888;font-size:11px;">Add a new key:</div>
                <div class="mine-key-add-row">
                    <input type="text" id="mine-key-new-label" placeholder="Label (e.g. MonChoon)" style="flex:1;">
                    <input type="text" id="mine-key-new-value" placeholder="Paste API key here" style="flex:2;">
                    <button id="mine-key-add-btn" class="btn-save" style="padding:5px 12px;font-size:11px;border:none;border-radius:3px;cursor:pointer;font-weight:bold;white-space:nowrap;">+ Add</button>
                </div>
                <div class="mine-modal-btns">
                    <button id="mine-keys-close-btn" class="btn-cancel">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });
        document.getElementById('mine-keys-close-btn').addEventListener('click', () => overlay.classList.remove('visible'));

        const addKey = () => {
            const ki = document.getElementById('mine-key-new-value');
            const li = document.getElementById('mine-key-new-label');
            const key = ki.value.trim(); const label = li.value.trim();
            if (!key || key.length < 10) { alert('Please enter a valid API key.'); return; }
            const pool = getKeyPool();
            if (pool.some(e => e.key === key)) { alert('This key is already in the list.'); return; }
            pool.push({ key, label, status: 'unknown', lastError: '', disabled: false });
            saveKeyPool(pool); ki.value = ''; li.value = '';
            renderKeyTable(); refreshHeaderCount();
        };
        document.getElementById('mine-key-add-btn').addEventListener('click', addKey);
        document.getElementById('mine-key-new-value').addEventListener('keydown', e => { if (e.key === 'Enter') addKey(); });
    }

    function openKeyManagerModal() {
        const overlay = document.getElementById('mine-keys-overlay'); if (!overlay) return;
        renderKeyTable(); overlay.classList.add('visible');
    }

    // =========================================================================
    // SETTINGS MODAL (history)
    // =========================================================================
    function injectSettingsModal() {
        if (document.getElementById('mine-settings-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'mine-settings-overlay'; overlay.className = 'mine-overlay';
        overlay.innerHTML = `
            <div class="mine-modal" style="width:460px;">
                <h3>&#9881; History Settings</h3>
                <div class="mine-settings-section">
                    <h4>Messaged Users Database</h4>
                    <div class="history-stats" id="mine-history-stats">Loading&#8230;</div>
                </div>
                <div class="mine-settings-section">
                    <h4>Clear Users Older Than</h4>
                    <div class="mine-settings-row">
                        <label for="mine-clear-days">Remove entries older than</label>
                        <input type="number" id="mine-clear-days" min="1" value="30">
                        <span style="color:#888;">days</span>
                    </div>
                </div>
                <div class="mine-settings-section">
                    <h4>Clear All Users</h4>
                    <div style="color:#888;font-size:11px;margin-bottom:6px;">Wipes the entire database.</div>
                    <button id="mine-clear-all-btn" class="btn-danger" style="align-self:flex-start;padding:4px 14px;font-size:12px;border:none;border-radius:3px;cursor:pointer;font-weight:bold;">&#128465; Clear All</button>
                </div>
                <div class="mine-settings-section">
                    <h4>Working Stats Cache</h4>
                    <div class="history-stats" id="mine-cache-stats">&#8230;</div>
                    <div style="color:#888;font-size:11px;">Cached for 24h to keep API calls down. Clear this if you want fresh numbers now.</div>
                    <button id="mine-clear-cache-btn" class="btn-neutral" style="align-self:flex-start;padding:4px 14px;font-size:12px;border:none;border-radius:3px;cursor:pointer;font-weight:bold;">&#9851; Clear Stats Cache</button>
                </div>
                <div class="mine-settings-btns">
                    <button id="mine-clear-older-btn" class="btn-save">Clear Older Than X Days</button>
                    <button id="mine-settings-close-btn" class="btn-cancel">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });
        document.getElementById('mine-settings-close-btn').addEventListener('click', () => overlay.classList.remove('visible'));
        document.getElementById('mine-clear-older-btn').addEventListener('click', () => {
            const days = parseInt(document.getElementById('mine-clear-days').value) || 30;
            const h = getHistory(); const now = Date.now(); const cutoff = days * 86400000;
            const count = Object.values(h).filter(ts => now - ts >= cutoff).length;
            if (!count) { alert('[Mine Recruiter] No users older than ' + days + ' days.'); return; }
            if (confirm('[Mine Recruiter] Remove ' + count + ' user(s)?')) { clearHistoryOlderThan(days); refreshSettingsStats(); refreshHeaderCount(); refreshButtons(); }
        });
        document.getElementById('mine-clear-all-btn').addEventListener('click', () => {
            const count = Object.keys(getHistory()).length;
            if (!count) { alert('[Mine Recruiter] History is empty.'); return; }
            if (confirm('[Mine Recruiter] Clear ALL ' + count + ' user(s)?')) { clearHistoryOlderThan(0); refreshSettingsStats(); refreshHeaderCount(); refreshButtons(); }
        });
        document.getElementById('mine-clear-cache-btn').addEventListener('click', () => {
            const n = clearStatsCache();
            alert('[Mine Recruiter] Cleared ' + n + ' cached stat entr' + (n === 1 ? 'y' : 'ies') + '.');
            refreshSettingsStats();
        });
    }

    function refreshSettingsStats() {
        const el = document.getElementById('mine-history-stats');
        if (el) {
            const s = getHistoryStats();
            el.textContent = !s.total ? 'No users in database.' : s.total + ' user(s). Oldest: ' + s.oldestDays + 'd ago. Newest: ' + s.newestDays + 'd ago.';
        }
        const ce = document.getElementById('mine-cache-stats');
        if (ce) {
            const n = Object.keys(pruneStatsCache()).length;
            ce.textContent = n ? n + ' cached user(s), 24h TTL.' : 'Cache is empty.';
        }
    }

    function openSettingsModal() {
        const overlay = document.getElementById('mine-settings-overlay'); if (!overlay) return;
        refreshSettingsStats(); overlay.classList.add('visible');
    }

    // =========================================================================
    // MESSAGE MODAL
    // =========================================================================
    function injectMessageModal() {
        if (document.getElementById('mine-msg-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'mine-msg-overlay'; overlay.className = 'mine-overlay';
        overlay.innerHTML = `
            <div class="mine-modal">
                <h3>&#9999; Edit Recruitment Message</h3>
                <textarea id="mine-msg-textarea" spellcheck="true"></textarea>
                <div class="mine-modal-btns">
                    <button id="mine-msg-reset" class="btn-neutral">Reset to default</button>
                    <button id="mine-msg-cancel" class="btn-cancel">Cancel</button>
                    <button id="mine-msg-save" class="btn-save">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });
        document.getElementById('mine-msg-cancel').addEventListener('click', () => overlay.classList.remove('visible'));
        document.getElementById('mine-msg-reset').addEventListener('click', () => {
            if (confirm('Reset to default message?')) document.getElementById('mine-msg-textarea').value = DEFAULT_RECRUIT_MESSAGE;
        });
        document.getElementById('mine-msg-save').addEventListener('click', () => {
            const v = document.getElementById('mine-msg-textarea').value.trim();
            if (!v) { alert('Message cannot be empty.'); return; }
            setRecruitMessage(v); overlay.classList.remove('visible');
        });
    }

    function openMessageModal() {
        const overlay = document.getElementById('mine-msg-overlay'); if (!overlay) return;
        document.getElementById('mine-msg-textarea').value = getRecruitMessage();
        overlay.classList.add('visible');
        document.getElementById('mine-msg-textarea').focus();
    }

    // =========================================================================
    // FILTERS MODAL
    // =========================================================================
    function injectFiltersModal() {
        if (document.getElementById('mine-filters-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'mine-filters-overlay'; overlay.className = 'mine-overlay';
        overlay.innerHTML = `
            <div class="mine-modal" style="width:360px;">
                <h3>&#9881; Enrichment Filters</h3>
                <p style="margin:0;color:#888;font-size:11px;">
                    Filters the <b>working_stats</b> value from Torn's Hall of Fame API.<br>
                    Leave a field blank to apply no limit in that direction.
                </p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;align-items:center;margin-top:4px;">
                    <label style="color:#ccc;">Min Working Stats</label>
                    <input type="number" id="mf-minStats" min="0" placeholder="e.g. 100000"
                        style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:3px;padding:5px 8px;width:100%;box-sizing:border-box;">
                    <label style="color:#ccc;">Max Working Stats</label>
                    <input type="number" id="mf-maxStats" min="0" placeholder="blank = no limit"
                        style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:3px;padding:5px 8px;width:100%;box-sizing:border-box;">
                </div>
                <div style="color:#666;font-size:10px;">Enter raw numbers. Badge shows compact form (512k, 2.5m, 1.3b).</div>
                <div class="mine-modal-btns">
                    <button id="mf-reset" class="btn-neutral">Clear limits</button>
                    <button id="mf-cancel" class="btn-cancel">Cancel</button>
                    <button id="mf-save" class="btn-save">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });
        document.getElementById('mf-cancel').addEventListener('click', () => overlay.classList.remove('visible'));
        document.getElementById('mf-reset').addEventListener('click', () => {
            document.getElementById('mf-minStats').value = '';
            document.getElementById('mf-maxStats').value = '';
        });
        document.getElementById('mf-save').addEventListener('click', () => {
            const s = getEnrichSettings();
            s.minStats = parseInt(document.getElementById('mf-minStats').value) || 0;
            s.maxStats = parseInt(document.getElementById('mf-maxStats').value) || 0;
            saveEnrichSettings(s); overlay.classList.remove('visible');
        });
    }

    function openFiltersModal() {
        const overlay = document.getElementById('mine-filters-overlay'); if (!overlay) return;
        const s = getEnrichSettings();
        document.getElementById('mf-minStats').value = s.minStats || '';
        document.getElementById('mf-maxStats').value = s.maxStats || '';
        overlay.classList.add('visible');
    }

    // =========================================================================
    // HEADER
    // =========================================================================
    function injectHeader() {
        if (document.getElementById('mine-recruiter-header')) return;
        const header = document.createElement('div');
        header.id = 'mine-recruiter-header';

        const label = document.createElement('span');
        label.innerHTML = '<b>&#9935; Mine Recruiter</b>';

        const keyBtn = document.createElement('button');
        keyBtn.id = 'mine-key-mgr-btn';
        keyBtn.textContent = 'Keys (' + getKeyPool().length + ')';
        keyBtn.title = 'Manage API keys (Public Access or higher)';
        keyBtn.addEventListener('click', openKeyManagerModal);

        const historyBtn = document.createElement('button');
        historyBtn.id = 'mine-clear-history-btn';
        historyBtn.textContent = 'History (' + Object.keys(getHistory()).length + ')';
        historyBtn.title = 'Manage messaged users database';
        historyBtn.addEventListener('click', openSettingsModal);

        const filtersBtn = document.createElement('button');
        filtersBtn.textContent = 'Filters';
        filtersBtn.title = 'Set min/max working stats filter';
        filtersBtn.addEventListener('click', openFiltersModal);

        const enrichSettings = getEnrichSettings();
        const enrichToggleBtn = document.createElement('button');
        enrichToggleBtn.id = 'mine-enrich-toggle';
        enrichToggleBtn.textContent = enrichSettings.enabled ? 'Enrichment ON' : 'Enrichment OFF';
        enrichToggleBtn.style.background = enrichSettings.enabled ? 'rgba(58,125,58,0.4)' : 'rgba(255,255,255,0.1)';
        enrichToggleBtn.title = 'Toggle working stats enrichment';
        enrichToggleBtn.addEventListener('click', () => {
            const s = getEnrichSettings(); s.enabled = !s.enabled; saveEnrichSettings(s);
            enrichToggleBtn.textContent = s.enabled ? 'Enrichment ON' : 'Enrichment OFF';
            enrichToggleBtn.style.background = s.enabled ? 'rgba(58,125,58,0.4)' : 'rgba(255,255,255,0.1)';
        });

        const editMsgBtn = document.createElement('button');
        editMsgBtn.textContent = 'Message';
        editMsgBtn.title = 'Edit the recruitment message';
        editMsgBtn.addEventListener('click', openMessageModal);

        header.appendChild(label); header.appendChild(keyBtn); header.appendChild(historyBtn);
        header.appendChild(filtersBtn); header.appendChild(enrichToggleBtn); header.appendChild(editMsgBtn);

        const anchor = document.querySelector('.comphelp-widget') || document.querySelector('.content-title');
        if (anchor) anchor.after(header); else document.body.prepend(header);

        injectMessageModal(); injectFiltersModal(); injectSettingsModal(); injectKeyManagerModal();
    }

    // =========================================================================
    // MAIN
    // =========================================================================
    function init() {
        installDelegatedClickHandler();

        // Migrate legacy single-key to pool
        const legacyKey = GM_getValue('mine_recruiter_api_key', null);
        if (legacyKey && legacyKey.length > 5) {
            const pool = getKeyPool();
            if (!pool.some(e => e.key === legacyKey)) {
                pool.unshift({ key: legacyKey, label: 'Imported', status: 'unknown', lastError: '', disabled: false });
                saveKeyPool(pool);
            }
            GM_setValue('mine_recruiter_api_key', '');
        }

        const waitTitle = setInterval(() => {
            if (!document.querySelector('.content-title')) return;
            clearInterval(waitTitle); injectHeader();
        }, 200);

        const waitWrapper = setInterval(() => {
            const wrapper = document.querySelector('.userlist-wrapper'); if (!wrapper) return;
            clearInterval(waitWrapper); processRows();
            new MutationObserver(() => processRows()).observe(wrapper, { childList: true, subtree: true });
        }, 300);
    }

    init();

})();
