// ==UserScript==
// @name         Mine Recruiter
// @namespace    MonChoon_
// @version      3.11.1
// @description  Adds recruit buttons to the User Search page. Opens chat and pre-fills recruitment message. Uses Torn HOF API for working stats enrichment with multi-key rotation.
// @license      MIT
// @author       MonChoon [2250591]
// @match        https://www.torn.com/page.php*
// @connect      api.torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @downloadURL  https://github.com/DobrowneyT/torn-userscripts/raw/main/mine-recruiter.user.js
// @updateURL    https://github.com/DobrowneyT/torn-userscripts/raw/main/mine-recruiter.user.js
// ==/UserScript==

// CHANGELOG
// 3.11.1 - FIX: step 2 stopped DETECTING the chat it had just opened, because
//         Torn's Chat 3.1 renamed the panel root. 3.0 keyed it
//         `private-<me>-<them>`; 3.1 keys it `<them>` alone, with no prefix.
//         Nothing else moved - every in-panel selector matches a class PREFIX
//         (scrollWrapper___, iconWrapper___, closeIcon___, title___) and those
//         all survived - so the click worked, the window opened, and the script
//         then waited out the full 8s WAIT_TIMEOUT staring past a panel that
//         was on screen the whole time, before falling back to the clipboard.
//         Both id schemes are now accepted, since a userscript cannot know
//         which build a player is served.
//         ⚠️ A bare user id is a much weaker selector than a prefixed one, and
//         this script runs on a page full of user ids. A 3.1 candidate must
//         also LOOK like a panel (a textarea or a scrollWrapper___ inside it)
//         or the script would happily paste into an unrelated element and
//         report the message sent.
//         The tray fast path moved to findTrayButton(), which tries the 3.0
//         ids and a guessed 3.1 one. The tray was NOT in the captured DOM, so
//         that id is unverified - harmless, because a missed exact-id lookup
//         just falls through to the mini-profile route.
//         Also: @downloadURL and @updateURL pointed at `mine-recruiter.js`,
//         but the file in the repo is `mine-recruiter.user.js` - both 404, so
//         Tampermonkey has never been able to auto-update this script. Fixed,
//         which only takes effect from the NEXT version onward: this one has to
//         be installed by hand.
// 3.11.0 - $NAME in a message is replaced with the recruit's name.
//         Resolved from the open chat panel's header first - that is the name
//         Torn itself is showing for this conversation, so it cannot be the
//         wrong person even if the search list re-sorted underneath us - then
//         from the search row.
//         ⚠️ The row fallback reads `.honor-text:not(.honor-text-svg)`, not the
//         anchor text: Torn renders an honor bar as TWO copies of the name, a
//         per-character SVG one and a plain one, so the anchor's textContent
//         gives the name twice over.
//         If the template asks for a name and none can be read, NOTHING is
//         pasted and the button says so. "Hey $NAME," is worse than sending
//         nothing - it is visibly a failed mail merge, shown to the one person
//         being asked to judge whether this faction is worth joining.
//         The modal previews the substitution against a real row on screen, so
//         a mistyped token is caught before it reaches an inbox.
// 3.10.0 - Five saved message presets, and no hardcoded default.
//         The old DEFAULT_RECRUIT_MESSAGE baked one faction's pay rates and job
//         link into tracked source, where it went stale silently and was simply
//         wrong for anyone else running the script. "Reset to default" restored
//         that stale text over whatever you had written.
//         The modal now has five slots. Clicking one selects AND loads it;
//         "Save to preset" writes the box into the highlighted slot; "Use this
//         message" is what the recruit flow actually pastes. Slots can be named,
//         because five blocks of similar advert text are indistinguishable
//         otherwise, and a filled slot is coloured differently from an empty one.
//         Clicking an EMPTY slot does not wipe the box - you are almost
//         certainly about to save the draft you just typed into it.
//         Any existing single message is migrated into slot 1 on first run.
// 3.9.1 - FIX: 3.9.0 called recordDomAdditions()/dumpChatDiagnostics() but the
//         block defining them was never written to the file — a two-part edit
//         where the second half applied and the first did not. The result was a
//         synchronous ReferenceError on every step-2 click, caught by the outer
//         handler, which runs the clipboard fallback: the button jumped
//         straight to "Copied - open chat manually" and no chat ever opened.
//         `node --check` cannot catch this; an undefined function is valid
//         syntax. The definitions are now present.
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
    // =========================================================================
    // MESSAGE PRESETS
    // =========================================================================
    //
    // Five saved messages, and the one currently in use. There is deliberately
    // NO hardcoded default any more: the old one carried one faction's pay
    // rates and job link baked into tracked source, which went stale silently
    // and was wrong for anyone else running the script.
    //
    // An unset slot is an empty string, and an empty active message means the
    // recruit flow has nothing to paste — which the Message button says out
    // loud rather than pasting a stale advert on someone's behalf.
    const PRESET_COUNT = 5;
    const PRESETS_STORE = 'mine_recruit_presets';
    const ACTIVE_STORE  = 'mine_recruit_active';

    function getPresets() {
        try {
            const raw = JSON.parse(GM_getValue(PRESETS_STORE, 'null'));
            const out = Array.isArray(raw) ? raw.slice(0, PRESET_COUNT) : [];
            while (out.length < PRESET_COUNT) out.push({ label: '', text: '' });
            return out.map(function (p) {
                return { label: String((p && p.label) || ''), text: String((p && p.text) || '') };
            });
        } catch (e) {
            return Array.from({ length: PRESET_COUNT }, function () { return { label: '', text: '' }; });
        }
    }
    function savePresets(list) { GM_setValue(PRESETS_STORE, JSON.stringify(list)); }

    function getRecruitMessage() {
        // Migrate the pre-3.10 single message into slot 1 once, so nobody loses
        // the wording they were actually using.
        const legacy = GM_getValue('mine_recruit_message', '');
        if (legacy) {
            const list = getPresets();
            if (!list[0].text) { list[0] = { label: 'Imported', text: legacy }; savePresets(list); }
            GM_setValue('mine_recruit_message', '');
            return legacy;
        }
        return GM_getValue(ACTIVE_STORE, '');
    }
    function setRecruitMessage(msg) { GM_setValue(ACTIVE_STORE, msg); }
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

        .mine-preset-bar { display: flex; align-items: center; gap: 8px; }
        .mine-preset-hint { color: #888; font-size: 11px; }
        #mine-preset-slots { display: flex; gap: 5px; }
        .mine-preset-btn {
            width: 26px; height: 26px; border-radius: 4px; cursor: pointer;
            font-size: 11px; font-weight: bold; border: 1px solid #444;
            background: #2a2a2a; color: #777;
        }
        /* A filled slot has to look different from an empty one, or five
           identical numbers tell you nothing about where your messages are. */
        .mine-preset-btn.filled   { background: #1a3a1a; color: #9f9; border-color: #3a7d3a; }
        .mine-preset-btn.selected { outline: 2px solid #4488ff; outline-offset: 1px; }
        .mine-preset-btn:hover    { border-color: #666; }

        .mine-msg-hint { color: #888; font-size: 11px; line-height: 1.5; }
        .mine-msg-hint code {
            background: #2a2a2a; border: 1px solid #444; border-radius: 3px;
            padding: 1px 4px; color: #9f9; font-size: 10px;
        }
        #mine-msg-preview { display: block; margin-top: 4px; color: #66aaff; }
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
    //
    // ⚠️ Chat 3.1 renamed the panel ROOT, and that rename is the whole of what
    // this script needs to care about:
    //
    //     3.0   <div id="private-2250591-2576356" class="root___...">
    //     3.1   <div id="2576356"                 class="root___... visible___...">
    //
    // The id is now just the correspondent - no "private-" prefix, and no
    // mention of us at all. Every selector that reads INSIDE the panel still
    // matches, because they were all written against a class PREFIX rather
    // than a full hash: scrollWrapper___, textarea, iconWrapper___,
    // closeIcon___, title___ are all unchanged in 3.1.
    //
    // That combination is why the failure looked so odd. Step 2 clicked, the
    // chat genuinely opened, and then the script sat for the full 8s
    // WAIT_TIMEOUT unable to see a window that was plainly on screen, and gave
    // up to the clipboard fallback.
    //
    // Both schemes are accepted. A userscript cannot assume which build a given
    // player is served, and Torn has rolled a chat version back before.

    /**
     * Does this element look like a chat panel?
     *
     * ⚠️ Needed only for the 3.1 scheme. A bare user id is a far weaker selector
     * than one carrying a "private-" prefix, and the User Search page this
     * script runs on is a page FULL of user ids - any element Torn happens to
     * key by the same number would otherwise be accepted as the panel. The
     * script would then "succeed", paste into nothing, and report it sent.
     */
    function isChatPanel(el) {
        return !!(el && (el.querySelector('textarea')
            || el.querySelector('[class*="scrollWrapper___"]')));
    }

    /** A minimised or hidden panel sorts after a visible one. */
    function panelIsVisible(el) {
        return !/\bhidden___/.test(el.className || '') && el.offsetWidth > 0;
    }

    /** Every panel for this conversation, best candidate first. */
    function chatPanelsFor(userId) {
        const uid = String(userId);
        const found = [];
        const push = function (el) { if (el && found.indexOf(el) === -1) found.push(el); };

        // Chat 3.0. The prefix makes this unambiguous, so no shape check.
        [].forEach.call(document.querySelectorAll('div[id^="private-"]'), function (el) {
            if (el.id.indexOf(uid) !== -1) push(el);
        });

        // Chat 3.1. Guarded on a numeric id so the attribute selector can never
        // be malformed, and shape-checked per isChatPanel above.
        if (/^\d+$/.test(uid)) {
            [].forEach.call(document.querySelectorAll('div[id="' + uid + '"]'), function (el) {
                if (isChatPanel(el)) push(el);
            });
        }

        // Stable sort, so this only lifts visible panels above hidden ones and
        // otherwise leaves DOM order alone. It does not FILTER: a panel caught
        // mid-open is still the panel we want.
        return found.sort(function (a, b) { return panelIsVisible(b) - panelIsVisible(a); });
    }

    function waitForChatPanel(userId) {
        return new Promise(function(resolve, reject) {
            const start = Date.now();
            function tick() {
                const panel = chatPanelsFor(userId)[0];
                if (panel) return resolve(panel);
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
        return chatPanelsFor(userId)[0] || null;
    }

    /**
     * The tray button for a conversation that is already open.
     *
     * ⚠️ The 3.1 form is a GUESS - the tray was not in the captured DOM, only
     * the panel was. It costs nothing to guess here: these are exact
     * getElementById lookups, so a wrong id simply misses and the caller falls
     * through to the mini-profile route, which is the normal path anyway.
     */
    function findTrayButton(userId) {
        const myId = getMyUserId();
        const ids = [];
        if (myId) {
            ids.push('channel_panel_button:private-' + myId + '-' + userId);
            ids.push('channel_panel_button:private-' + userId + '-' + myId);
        }
        ids.push('channel_panel_button:' + userId);
        for (let i = 0; i < ids.length; i++) {
            const el = document.getElementById(ids[i]);
            if (el) return el;
        }
        return null;
    }

    function closeChatPanel(panel, userId) {
        if (!panel) return;
        const cb = findCloseButton(panel);
        if (cb) { cb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return; }
        const tray = findTrayButton(userId);
        if (tray) tray.click();
    }

    // =========================================================================
    // DIAGNOSTICS  (off by default)
    // =========================================================================
    //
    // Kept because this file has now been broken twice by Torn renaming things,
    // and both times the expensive part was not writing the fix but working out
    // WHICH of several identical-looking failures was happening. Guarded so it
    // costs nothing when off.
    //
    // Turn on from the console:
    //     GM_setValue('mine_debug', 'true')     // Tampermonkey storage panel
    // or, for one page load only:
    //     window.MINE_DEBUG = true
    // =========================================================================
    function debugOn() {
        if (typeof window !== 'undefined' && window.MINE_DEBUG) return true;
        try { return GM_getValue('mine_debug', 'false') === 'true'; } catch (e) { return false; }
    }

    function describeEl(el) {
        return el.tagName.toLowerCase()
            + (el.id ? '#' + el.id : '')
            + (el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : '');
    }

    /**
     * Record every element added to the DOM until stop().
     *
     * Timing a manual capture around a panel opening is near impossible by hand
     * — the interesting state is gone before you can select it. Arm this BEFORE
     * the action and read it back after.
     */
    function recordDomAdditions() {
        if (!debugOn()) return { stop: function () { return []; } };
        const added = [];
        const obs = new MutationObserver(function (muts) {
            for (const m of muts) {
                for (const n of m.addedNodes) if (n.nodeType === 1) added.push(n);
            }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        return { stop: function () { obs.disconnect(); return added; } };
    }

    /** What the page looked like when a chat panel failed to appear. */
    function dumpChatDiagnostics(userId, addedNodes) {
        if (!debugOn()) return;
        const chainOf = function (el) {
            const parts = [];
            let n = el;
            while (n && n !== document.body && parts.length < 12) { parts.unshift(describeEl(n)); n = n.parentElement; }
            return parts.join(' > ');
        };
        console.group('[Mine Recruiter] chat panel never appeared for ' + userId);
        console.log('my user id:', getMyUserId());
        console.log('mini profile present:', !!document.querySelector('.mini-profile-wrapper'));
        console.log('chat 3.0  div[id^="private-"]:', [].map.call(document.querySelectorAll('div[id^="private-"]'), describeEl));
        if (/^\d+$/.test(String(userId))) {
            const bare = [].slice.call(document.querySelectorAll('div[id="' + userId + '"]'));
            console.log('chat 3.1  div[id="' + userId + '"]:', bare.map(describeEl));
            console.log('  of those, shaped like a panel:', bare.filter(isChatPanel).length);
        }
        console.log('tray buttons:', [].map.call(document.querySelectorAll('[id^="channel_panel_button"]'), function (e) { return e.id; }));
        const added = addedNodes || [];
        console.log('elements added during the press:', added.length);
        const withInput = added.filter(function (n) {
            return n.matches && (n.matches('textarea, [contenteditable]') || n.querySelector('textarea, [contenteditable]'));
        });
        console.log('  of those, carrying a text input:', withInput.length);
        withInput.slice(0, 5).forEach(function (n, i) { console.log('  [' + i + '] ' + chainOf(n)); });
        added.slice(0, 25).forEach(function (n, i) { console.log('    ' + i + ': ' + describeEl(n)); });
        console.groupEnd();
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

            // Removing the hardcoded default created a state that could not
            // exist before: nothing configured to send. Say so on the button
            // rather than opening a chat and pasting an empty string, which
            // looks exactly like the script being broken.
            if (!RECRUIT_MESSAGE()) {
                btn.className = 'mine-recruit-btn warn'; btn.style.background = '';
                btn.textContent = '\u26A0 Set a message first';
                btn.title = 'Open "Message" in the Mine Recruiter header and save one.';
                return;
            }

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
                const message = messageFor(userId, p);
                if (!message) {
                    // The template wants a name and we could not read one.
                    // Pasting "Hey $NAME," is worse than pasting nothing.
                    btn.className = 'mine-recruit-btn warn'; btn.style.background = '';
                    btn.textContent = '\u26A0 Could not read their name';
                    btn.title = 'The message uses $NAME but the name could not be found on the page. Click to retry.';
                    console.warn('[Mine Recruiter] $NAME unresolved for ' + userId);
                    return;
                }
                navigator.clipboard.writeText(message).catch(function() {});
                if (ta) {
                    ta.focus(); setReactTextareaValue(ta, message);
                    recruitState[userId] = 'pasted'; btn.className = 'mine-recruit-btn send-ready'; btn.style.background = '';
                    btn.textContent = '\uD83D\uDCE8 Click to send';
                } else {
                    recruitState[userId] = 'pasted'; btn.className = 'mine-recruit-btn warn'; btn.style.background = '';
                    btn.textContent = '\uD83D\uDCCB Copied \u2014 paste manually then click send';
                }
                return;
            }

            // Tray fast path
            const trayBtn = findTrayButton(userId);
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
            clipboardFallback(btn, userId);
        }
    }

    function clipboardFallback(btn, userId) {
        // Resolve $NAME here too — this path ends with a human pasting it by
        // hand, and an unresolved token would go out exactly as typed.
        const message = messageFor(userId, getChatPanel(userId)) || RECRUIT_MESSAGE();
        navigator.clipboard.writeText(message).then(() => {
            btn.className = 'mine-recruit-btn sent'; btn.textContent = '\uD83D\uDCCB Copied \u2014 open chat manually';
            setTimeout(() => { btn.className = 'mine-recruit-btn ready'; btn.textContent = '\u26CF Recruit'; }, 5000);
        }).catch(() => { btn.className = 'mine-recruit-btn ready'; btn.textContent = '\u26CF Recruit'; alert('[Mine Recruiter] Could not copy to clipboard.'); });
    }

    // =========================================================================
    // $NAME SUBSTITUTION
    // =========================================================================

    /** Does this message ask for a name? */
    const NAME_TOKEN = /\$name\b/gi;

    /**
     * The target's display name, from the most trustworthy source available.
     *
     * Three sources, best first. The CHAT PANEL header wins because it is the
     * name Torn itself is showing for this exact conversation — the panel we
     * are about to paste into — so it cannot be the wrong person even if the
     * search row was re-rendered or re-sorted underneath us.
     *
     * ⚠️ The search-row fallback reads `.honor-text:not(.honor-text-svg)`, not
     * the anchor's text. Torn renders an honor bar as TWO copies of the name:
     * a per-character SVG version (`.honor-text-svg`, one <span data-char>
     * each) and a plain one. Taking the anchor's textContent concatenates both
     * and yields the name twice over.
     */
    function targetDisplayName(userId, panel) {
        const clean = (el) => (el && el.textContent ? el.textContent.trim() : '');

        // 1. The open chat panel's header.
        const fromPanel = panel && panel.querySelector('[class*="title___"]');
        if (clean(fromPanel)) return clean(fromPanel);

        const row = document.querySelector('li.user' + userId)
            || document.querySelector('li[class*="user' + userId + '"]');
        if (row) {
            // 2. The plain half of the honor bar.
            const plain = row.querySelector('.honor-text:not(.honor-text-svg)');
            if (clean(plain)) return clean(plain);
            // 3. The name link, with any SVG honor copy stripped out first.
            const link = row.querySelector('a.user.name')
                || row.querySelector('a[href*="profiles.php?XID=' + userId + '"]');
            if (link) {
                const copy = link.cloneNode(true);
                copy.querySelectorAll('.honor-text-svg').forEach((n) => n.remove());
                if (clean(copy)) return clean(copy);
            }
        }
        return null;
    }

    /**
     * The message to actually send, with $NAME resolved.
     *
     * Returns null when the message asks for a name we cannot find. Sending
     * "Hey $NAME," is worse than sending nothing: it is visibly a mail merge
     * that failed, to the one audience being asked to judge whether this
     * faction is worth joining. The caller says so on the button instead.
     */
    function messageFor(userId, panel) {
        const template = RECRUIT_MESSAGE();
        if (!template) return null;
        NAME_TOKEN.lastIndex = 0;
        if (!NAME_TOKEN.test(template)) return template;
        const name = targetDisplayName(userId, panel);
        if (!name) return null;
        return template.replace(NAME_TOKEN, name);
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
                <h3>&#9999; Recruitment Message</h3>
                <div class="mine-preset-bar">
                    <span class="mine-preset-hint">Presets:</span>
                    <span id="mine-preset-slots"></span>
                </div>
                <input type="text" id="mine-preset-label" class="label-input" placeholder="Name for this preset (optional)">
                <textarea id="mine-msg-textarea" spellcheck="true"></textarea>
                <div class="mine-msg-hint">
                    Write <code>$NAME</code> anywhere and it is replaced with the
                    recruit's name when the message is sent.
                    <span id="mine-msg-preview"></span>
                </div>
                <div class="mine-modal-btns">
                    <button id="mine-msg-store" class="btn-neutral" title="Write what is in the box into the highlighted preset slot">Save to preset</button>
                    <button id="mine-msg-cancel" class="btn-cancel">Cancel</button>
                    <button id="mine-msg-save" class="btn-save" title="Use this message for recruiting">Use this message</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('visible'); });
        document.getElementById('mine-msg-cancel').addEventListener('click', () => overlay.classList.remove('visible'));
        document.getElementById('mine-msg-textarea').addEventListener('input', renderMessagePreview);
        document.getElementById('mine-msg-store').addEventListener('click', () => {
            const text = document.getElementById('mine-msg-textarea').value.trim();
            if (!text) { alert('Nothing to save \u2014 the message box is empty.'); return; }
            const list = getPresets();
            list[selectedPreset] = { label: document.getElementById('mine-preset-label').value.trim(), text };
            savePresets(list);
            renderPresetSlots();
        });
        document.getElementById('mine-msg-save').addEventListener('click', () => {
            const v = document.getElementById('mine-msg-textarea').value.trim();
            if (!v) { alert('Message cannot be empty.'); return; }
            setRecruitMessage(v); overlay.classList.remove('visible');
        });
    }

    // Which slot the label field and "Save to preset" are pointed at. Clicking a
    // slot both selects it AND loads it, so one click does the obvious thing.
    let selectedPreset = 0;

    function renderPresetSlots() {
        const host = document.getElementById('mine-preset-slots');
        if (!host) return;
        const list = getPresets();
        host.innerHTML = '';
        list.forEach(function (preset, i) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mine-preset-btn'
                + (i === selectedPreset ? ' selected' : '')
                + (preset.text ? ' filled' : ' empty');
            b.textContent = String(i + 1);
            // The label is the whole point of naming a slot: it is how you tell
            // five blocks of similar-looking advert text apart at a glance.
            b.title = preset.text
                ? (preset.label || 'Preset ' + (i + 1)) + '\n\n' + preset.text.slice(0, 200)
                : 'Empty slot \u2014 put text in the box and press "Save to preset"';
            b.addEventListener('click', function () {
                selectedPreset = i;
                const current = getPresets()[i];
                if (current.text) {
                    document.getElementById('mine-msg-textarea').value = current.text;
                    document.getElementById('mine-preset-label').value = current.label;
                } else {
                    // Do NOT wipe what is in the box for an empty slot — you are
                    // almost certainly about to save the draft you just typed.
                    document.getElementById('mine-preset-label').value = '';
                }
                renderPresetSlots();
            });
            host.appendChild(b);
        });
    }

    function openMessageModal() {
        const overlay = document.getElementById('mine-msg-overlay'); if (!overlay) return;
        const active = getRecruitMessage();
        document.getElementById('mine-msg-textarea').value = active;
        // Open on the slot whose text is in use, so the label field and the
        // save button start pointed somewhere honest.
        const list = getPresets();
        const match = list.findIndex(function (p) { return p.text && p.text === active; });
        selectedPreset = match >= 0 ? match : 0;
        document.getElementById('mine-preset-label').value = list[selectedPreset].label;
        renderPresetSlots();
        renderMessagePreview();
        overlay.classList.add('visible');
        document.getElementById('mine-msg-textarea').focus();
    }

    /**
     * Show what $NAME will become, using a real recruit from the current page.
     *
     * A placeholder you cannot see working is a placeholder people mistype and
     * only discover in someone's inbox. This resolves against the first row on
     * screen so the substitution is visible before it is ever sent.
     */
    function renderMessagePreview() {
        const out = document.getElementById('mine-msg-preview');
        const box = document.getElementById('mine-msg-textarea');
        if (!out || !box) return;
        NAME_TOKEN.lastIndex = 0;
        if (!NAME_TOKEN.test(box.value)) { out.textContent = ''; return; }
        const row = document.querySelector('.userlist-wrapper .user-info-list-wrap > li[class*="user"]');
        const m = row && row.className.match(/\buser(\d+)\b/);
        const sample = m ? targetDisplayName(m[1], null) : null;
        out.textContent = sample
            ? 'Preview with ' + sample + ': ' + box.value.replace(NAME_TOKEN, sample).split('\n')[0]
            : '\u26A0 No recruit rows on screen to preview against.';
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
