// ==UserScript==
// @name         RR Clock Alerts
// @namespace    tos-MonChoon_
// @version      1.1
// @description  Tiered visual/audible warnings for the Russian Roulette game timeout and your shot clock, an alert when the opponent's clock expires, and a win ping so you know to stash your winnings.
// @license      MIT
// @author       MonChoon [2250591]
// @match        https://www.torn.com/page.php?sid=russianRoulette*
// @downloadURL  https://github.com/MonChoon/torn-userscripts/raw/main/rr-clock-alerts.user.js
// @updateURL    https://github.com/MonChoon/torn-userscripts/raw/main/rr-clock-alerts.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        window.onurlchange
// ==/UserScript==

(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // Defaults. All of this is user-editable from the panel and persisted.
    // Tier times are stored as seconds remaining; the alert fires when the
    // live counter drops to or below that value.
    // -------------------------------------------------------------------------
    const DEFAULTS = {
        outputs: {
            sound: true,
            flash: true,
            titleFlash: true,
            osNotify: false
        },
        timeout: {
            label: 'Game timeout',
            enabled: true,
            tiers: {
                green: { time: 470, enabled: true, repeat: false, interval: 30 }, // 7:50
                amber: { time: 300, enabled: true, repeat: false, interval: 30 }, // 5:00
                red:   { time: 180, enabled: true, repeat: true,  interval: 30 }  // 3:00
            }
        },
        shot: {
            label: 'Your shot clock',
            enabled: true,
            tiers: {
                green: { time: 120, enabled: true, repeat: false, interval: 5 }, // 2:00
                amber: { time: 60,  enabled: true, repeat: false, interval: 5 }, // 1:00
                red:   { time: 30,  enabled: true, repeat: true,  interval: 5 }  // 0:30
            }
        },
        opponent: {
            label: 'Opponent clock expires',
            enabled: true
        },
        win: {
            label: 'You won \u2014 stash your money',
            enabled: true
        },
        panel: { x: null, y: null, collapsed: true }
    };

    const TIER_COLORS = { green: '#3ea66b', amber: '#e0a526', red: '#d4453d' };
    const TIER_ORDER = ['green', 'amber', 'red'];

    // -------------------------------------------------------------------------
    // Settings load/save. Deep-merge so new default keys survive old saves.
    // -------------------------------------------------------------------------
    function deepMerge(base, over) {
        const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
        for (const k in over) {
            if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) &&
                base[k] && typeof base[k] === 'object') {
                out[k] = deepMerge(base[k], over[k]);
            } else {
                out[k] = over[k];
            }
        }
        return out;
    }

    let settings = deepMerge(DEFAULTS, GM_getValue('rrAlertSettings', {}));

    function save() {
        GM_setValue('rrAlertSettings', settings);
    }

    // -------------------------------------------------------------------------
    // State detection. The status banner text is the primary signal; the
    // SHOOT button presence is a fallback used only to confirm opponent expiry.
    // Selectors use substring matching because Torn rotates hashed suffixes.
    // -------------------------------------------------------------------------
    const STATE = {
        WAITING: 'WAITING_FOR_PLAYER',
        MINE: 'MY_TURN',
        THEIRS: 'THEIR_TURN',
        WIN: 'WIN',
        IDLE: 'IDLE'
    };

    function getBannerText() {
        const el = document.querySelector('[class*="message___"], [class*="messageWrap___"] span');
        return el ? el.textContent.trim().toLowerCase() : '';
    }

    function shootButtonsPresent() {
        // The SHOOT/X2/X3 buttons only render on your turn.
        const btns = Array.from(document.querySelectorAll('button, [class*="btn"]'));
        return btns.some(b => /^\s*shoot\s*$/i.test(b.textContent || ''));
    }

    function getCounterText() {
        const el = document.querySelector('[class*="counter___"]');
        return el ? el.textContent.trim() : null;
    }

    function parseClock(txt) {
        if (!txt) return null;
        const m = txt.match(/(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }

    function detectState() {
        const banner = getBannerText();
        if (!banner && getCounterText() === null) return STATE.IDLE;

        // Win must be checked first: it happens on the opponent's turn and the
        // banner still reads "BANG!". A loss also says BANG, so match the win
        // text specifically ("take your winnings"/"walk away") and never the
        // loss text ("you fall down").
        if ((banner.includes('take your winnings') || banner.includes('walk away')) &&
            !banner.includes('you fall down')) {
            return STATE.WIN;
        }

        if (banner.includes('waiting for a participant') ||
            banner.includes('pull up a chair')) {
            return STATE.WAITING;
        }
        if (banner.includes("it's your go") || banner.includes('its your go') ||
            banner.includes('your odds of getting the bullet')) {
            return STATE.MINE;
        }
        if (banner.includes('pass the revolver') ||
            banner.includes('passes the revolver') ||
            banner.includes('focuses their aim')) {
            return STATE.THEIRS;
        }
        // Fallback: shoot buttons => my turn.
        if (shootButtonsPresent()) return STATE.MINE;
        return STATE.IDLE;
    }

    // -------------------------------------------------------------------------
    // Alert engine. Tracks the current "turn signature" so tiers re-arm when
    // a new turn/game begins (counter jumps back up, or state changes).
    // -------------------------------------------------------------------------
    let lastState = STATE.IDLE;
    let lastSeconds = null;
    let armed = {};        // tierKey -> bool (false once fired, until re-armed)
    let lastRepeat = {};   // tierKey -> timestamp of last repeat fire
    let opponentFired = false;
    let winFired = false;

    function rearm(profileName) {
        const prof = settings[profileName];
        if (!prof || !prof.tiers) return;
        for (const t of TIER_ORDER) {
            armed[`${profileName}.${t}`] = true;
            lastRepeat[`${profileName}.${t}`] = 0;
        }
    }

    function rearmAll() {
        rearm('timeout');
        rearm('shot');
        opponentFired = false;
        winFired = false;
    }

    function tick() {
        const state = detectState();
        const counterTxt = getCounterText();
        const seconds = parseClock(counterTxt);

        // Re-arm on state change or when the counter resets upward (new turn).
        if (state !== lastState) {
            rearmAll();
            lastState = state;
            lastSeconds = seconds;
        } else if (seconds !== null && lastSeconds !== null && seconds > lastSeconds + 2) {
            rearmAll();
            lastSeconds = seconds;
        } else {
            lastSeconds = seconds;
        }

        if (state === STATE.WAITING && settings.timeout.enabled && seconds !== null) {
            evaluateProfile('timeout', seconds);
        } else if (state === STATE.MINE && settings.shot.enabled && seconds !== null) {
            evaluateProfile('shot', seconds);
        } else if (state === STATE.THEIRS && settings.opponent.enabled) {
            // Single fire the moment their clock is gone (<=0 or counter vanished).
            const expired = (seconds !== null && seconds <= 0) || counterTxt === null;
            if (expired && !opponentFired) {
                opponentFired = true;
                fireAlert('red', 'Opponent\u2019s clock is up \u2014 take the shot!');
            }
        } else if (state === STATE.WIN && settings.win.enabled) {
            if (!winFired) {
                winFired = true;
                fireAlert('green', 'You won \u2014 stash your winnings!');
            }
        }
    }

    function evaluateProfile(profileName, seconds) {
        const tiers = settings[profileName].tiers;
        // Highest-priority crossed tier wins (red > amber > green).
        for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
            const key = TIER_ORDER[i];
            const tier = tiers[key];
            if (!tier.enabled) continue;
            if (seconds > tier.time) continue;

            const armKey = `${profileName}.${key}`;
            const now = Date.now();

            if (armed[armKey]) {
                armed[armKey] = false;
                lastRepeat[armKey] = now;
                fireAlert(key, alertLabel(profileName, key, seconds));
                return;
            }
            if (tier.repeat) {
                const due = now - (lastRepeat[armKey] || 0) >= tier.interval * 1000;
                if (due) {
                    lastRepeat[armKey] = now;
                    fireAlert(key, alertLabel(profileName, key, seconds));
                }
            }
            return; // a tier is active; don't also fire lower tiers
        }
    }

    function alertLabel(profileName, tier, seconds) {
        const mm = Math.max(0, Math.floor(seconds / 60));
        const ss = Math.max(0, seconds % 60).toString().padStart(2, '0');
        const what = profileName === 'timeout' ? 'Game expiring' : 'Your shot';
        return `${what}: ${mm}:${ss} left`;
    }

    // -------------------------------------------------------------------------
    // Output channels.
    // -------------------------------------------------------------------------
    let audioCtx = null;
    function beep(tier) {
        if (!settings.outputs.sound) return;
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            const patterns = {
                green: [[660, 0.12]],
                amber: [[660, 0.1], [660, 0.1]],
                red:   [[880, 0.1], [880, 0.1], [1040, 0.18]]
            };
            const seq = patterns[tier] || patterns.green;
            let t = audioCtx.currentTime;
            for (const [freq, dur] of seq) {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'square';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.0001, t);
                gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
                osc.connect(gain).connect(audioCtx.destination);
                osc.start(t);
                osc.stop(t + dur);
                t += dur + 0.06;
            }
        } catch (e) { /* audio not available */ }
    }

    let flashEl = null;
    function screenFlash(tier) {
        if (!settings.outputs.flash) return;
        if (!flashEl) {
            flashEl = document.createElement('div');
            flashEl.id = 'rr-alert-flash';
            document.body.appendChild(flashEl);
        }
        flashEl.style.background = TIER_COLORS[tier] || TIER_COLORS.green;
        flashEl.style.opacity = '0';
        // restart animation
        flashEl.style.animation = 'none';
        void flashEl.offsetWidth;
        flashEl.style.animation = 'rrFlashPulse 0.6s ease-out 2';
    }

    let titleTimer = null;
    let originalTitle = document.title;
    function titleFlash(message) {
        if (!settings.outputs.titleFlash || !document.hidden) return;
        if (titleTimer) return; // already flashing
        let on = false;
        let count = 0;
        titleTimer = setInterval(() => {
            document.title = on ? originalTitle : `\u26A0\uFE0F ${message}`;
            on = !on;
            if (++count > 12 || !document.hidden) {
                clearInterval(titleTimer);
                titleTimer = null;
                document.title = originalTitle;
            }
        }, 600);
    }

    function osNotify(tier, message) {
        if (!settings.outputs.osNotify || !document.hidden) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        try {
            const n = new Notification('Russian Roulette', {
                body: message,
                tag: 'rr-alert-' + tier,
                requireInteraction: tier === 'red'
            });
            setTimeout(() => n.close(), 8000);
        } catch (e) { /* ignore */ }
    }

    function fireAlert(tier, message) {
        beep(tier);
        screenFlash(tier);
        titleFlash(message);
        osNotify(tier, message);
    }

    // -------------------------------------------------------------------------
    // Settings panel UI.
    // -------------------------------------------------------------------------
    GM_addStyle(`
        #rr-alert-flash {
            position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;
            opacity: 0;
        }
        @keyframes rrFlashPulse {
            0% { opacity: 0; } 30% { opacity: 0.55; } 100% { opacity: 0; }
        }
        #rr-panel {
            position: fixed; z-index: 2147483647; top: 90px; right: 16px;
            width: 300px; font-family: ui-sans-serif, system-ui, sans-serif;
            color: #e8e6e0; background: #15171c;
            border: 1px solid #2c2f37; border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            font-size: 12px; user-select: none;
        }
        #rr-panel * { box-sizing: border-box; }
        #rr-panel .rr-head {
            display: flex; align-items: center; justify-content: space-between;
            padding: 9px 11px; cursor: move; background: #1c1f26;
            border-radius: 10px 10px 0 0; border-bottom: 1px solid #2c2f37;
        }
        #rr-panel .rr-title {
            font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
            font-size: 11px; color: #e0a526;
        }
        #rr-panel .rr-collapse {
            cursor: pointer; background: none; border: none; color: #9a9ea8;
            font-size: 15px; line-height: 1; padding: 0 4px;
        }
        #rr-panel .rr-body { padding: 10px 11px 12px; max-height: 70vh; overflow-y: auto; }
        #rr-panel.rr-collapsed .rr-body { display: none; }
        #rr-panel .rr-section { margin-bottom: 12px; }
        #rr-panel .rr-section > h4 {
            margin: 0 0 6px; font-size: 11px; text-transform: uppercase;
            letter-spacing: 0.05em; color: #c4c8d0; font-weight: 600;
            display: flex; align-items: center; gap: 6px;
        }
        #rr-panel .rr-row {
            display: flex; align-items: center; gap: 6px; margin: 4px 0;
        }
        #rr-panel .rr-row label { flex: 1; color: #b9bdc6; }
        #rr-panel .rr-tier { display: grid; grid-template-columns: 14px 58px 1fr auto; gap: 6px; align-items: center; margin: 4px 0; }
        #rr-panel .rr-dot { width: 10px; height: 10px; border-radius: 50%; }
        #rr-panel input[type="text"], #rr-panel input[type="number"] {
            background: #0e1014; border: 1px solid #2c2f37; color: #e8e6e0;
            border-radius: 5px; padding: 3px 5px; width: 100%; font-size: 12px;
        }
        #rr-panel input[type="number"] { width: 48px; }
        #rr-panel .rr-rep { display: flex; align-items: center; gap: 3px; color: #9a9ea8; font-size: 11px; }
        #rr-panel button.rr-btn {
            background: #2a2e37; border: 1px solid #3a3f49; color: #e8e6e0;
            border-radius: 5px; padding: 4px 8px; cursor: pointer; font-size: 11px;
        }
        #rr-panel button.rr-btn:hover { background: #343a45; }
        #rr-panel .rr-test { padding: 1px 6px; font-size: 10px; }
        #rr-panel .rr-foot { display: flex; gap: 6px; margin-top: 6px; }
        #rr-panel .rr-note { color: #71757e; font-size: 10px; margin-top: 4px; line-height: 1.4; }
        #rr-badge {
            position: fixed; z-index: 2147483647; top: 90px; right: 16px;
            width: 34px; height: 34px; border-radius: 50%; cursor: pointer;
            background: #15171c; border: 1px solid #2c2f37; color: #e0a526;
            display: flex; align-items: center; justify-content: center;
            font-weight: 700; font-size: 13px; box-shadow: 0 6px 18px rgba(0,0,0,0.5);
        }
        @media (prefers-reduced-motion: reduce) {
            @keyframes rrFlashPulse { 0%,100% { opacity: 0; } 50% { opacity: 0.4; } }
        }
    `);

    function secToMMSS(s) {
        const mm = Math.floor(s / 60);
        const ss = (s % 60).toString().padStart(2, '0');
        return `${mm}:${ss}`;
    }
    function mmssToSec(str) {
        const m = String(str).match(/(\d{1,2}):(\d{2})/);
        if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        const n = parseInt(str, 10);
        return isNaN(n) ? null : n;
    }

    let panel = null;
    let badge = null;

    function buildPanel() {
        panel = document.createElement('div');
        panel.id = 'rr-panel';
        if (settings.panel.collapsed) panel.classList.add('rr-collapsed');
        positionPanel();

        panel.innerHTML = `
            <div class="rr-head">
                <span class="rr-title">RR Alerts</span>
                <button class="rr-collapse" title="Collapse">\u2013</button>
            </div>
            <div class="rr-body"></div>
        `;
        document.body.appendChild(panel);

        const body = panel.querySelector('.rr-body');
        body.appendChild(outputsSection());
        body.appendChild(profileSection('timeout'));
        body.appendChild(profileSection('shot'));
        body.appendChild(opponentSection());
        body.appendChild(winSection());

        // Collapse to badge.
        panel.querySelector('.rr-collapse').addEventListener('click', () => {
            settings.panel.collapsed = true; save();
            panel.style.display = 'none';
            badge.style.display = 'flex';
        });

        makeDraggable(panel, panel.querySelector('.rr-head'));

        badge = document.createElement('div');
        badge.id = 'rr-badge';
        badge.textContent = 'RR';
        badge.title = 'Open RR Alerts';
        badge.style.display = settings.panel.collapsed ? 'flex' : 'none';
        if (settings.panel.collapsed) panel.style.display = 'none';
        badge.addEventListener('click', () => {
            settings.panel.collapsed = false; save();
            panel.classList.remove('rr-collapsed');
            panel.style.display = 'block';
            badge.style.display = 'none';
        });
        document.body.appendChild(badge);
    }

    function positionPanel() {
        if (settings.panel.x !== null && settings.panel.y !== null) {
            panel.style.left = settings.panel.x + 'px';
            panel.style.top = settings.panel.y + 'px';
            panel.style.right = 'auto';
        }
    }

    function outputsSection() {
        const sec = document.createElement('div');
        sec.className = 'rr-section';
        sec.innerHTML = `<h4>Alert outputs</h4>`;
        const items = [
            ['sound', 'Sound'],
            ['flash', 'Screen flash'],
            ['titleFlash', 'Tab title flash (when hidden)'],
            ['osNotify', 'OS notification (when hidden)']
        ];
        for (const [key, lbl] of items) {
            const row = document.createElement('div');
            row.className = 'rr-row';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = settings.outputs[key];
            cb.addEventListener('change', () => {
                settings.outputs[key] = cb.checked;
                save();
                if (key === 'osNotify' && cb.checked) requestNotifyPermission(cb);
            });
            const label = document.createElement('label');
            label.textContent = lbl;
            row.appendChild(cb);
            row.appendChild(label);
            sec.appendChild(row);
        }
        const note = document.createElement('div');
        note.className = 'rr-note';
        note.textContent = 'Sound needs one click anywhere on the page first (browser autoplay rule).';
        sec.appendChild(note);
        return sec;
    }

    function requestNotifyPermission(cb) {
        if (!('Notification' in window)) {
            alert('This browser does not support OS notifications.');
            cb.checked = false; settings.outputs.osNotify = false; save();
            return;
        }
        if (Notification.permission === 'granted') return;
        Notification.requestPermission().then(p => {
            if (p !== 'granted') {
                cb.checked = false;
                settings.outputs.osNotify = false;
                save();
            }
        });
    }

    function profileSection(name) {
        const prof = settings[name];
        const sec = document.createElement('div');
        sec.className = 'rr-section';

        const h = document.createElement('h4');
        const enableCb = document.createElement('input');
        enableCb.type = 'checkbox';
        enableCb.checked = prof.enabled;
        enableCb.addEventListener('change', () => { prof.enabled = enableCb.checked; save(); });
        h.appendChild(enableCb);
        h.appendChild(document.createTextNode(prof.label));
        sec.appendChild(h);

        for (const tier of TIER_ORDER) {
            const t = prof.tiers[tier];
            const row = document.createElement('div');
            row.className = 'rr-tier';

            const en = document.createElement('input');
            en.type = 'checkbox';
            en.checked = t.enabled;
            en.title = 'Enable this tier';
            en.addEventListener('change', () => { t.enabled = en.checked; save(); });

            const time = document.createElement('input');
            time.type = 'text';
            time.value = secToMMSS(t.time);
            time.title = 'Trigger at this time remaining (M:SS)';
            time.addEventListener('change', () => {
                const v = mmssToSec(time.value);
                if (v !== null) { t.time = v; save(); }
                time.value = secToMMSS(t.time);
            });

            const rep = document.createElement('div');
            rep.className = 'rr-rep';
            const repCb = document.createElement('input');
            repCb.type = 'checkbox';
            repCb.checked = t.repeat;
            repCb.title = 'Repeat this alert';
            repCb.addEventListener('change', () => { t.repeat = repCb.checked; save(); });
            const repNum = document.createElement('input');
            repNum.type = 'number';
            repNum.min = '1';
            repNum.value = t.interval;
            repNum.title = 'Repeat interval (seconds)';
            repNum.addEventListener('change', () => {
                const v = parseInt(repNum.value, 10);
                if (!isNaN(v) && v > 0) { t.interval = v; save(); }
            });
            rep.appendChild(repCb);
            rep.appendChild(document.createTextNode('every'));
            rep.appendChild(repNum);
            rep.appendChild(document.createTextNode('s'));

            const test = document.createElement('button');
            test.className = 'rr-btn rr-test';
            test.textContent = 'Test';
            test.addEventListener('click', () => fireAlert(tier, `${prof.label} test`));

            const dotWrap = document.createElement('span');
            dotWrap.className = 'rr-dot';
            dotWrap.style.background = TIER_COLORS[tier];

            // grid: [enable cb] [time] [repeat block] [test]
            const c1 = document.createElement('span');
            c1.style.display = 'flex'; c1.style.alignItems = 'center'; c1.style.gap = '4px';
            c1.appendChild(en);
            row.appendChild(c1);
            row.appendChild(time);
            const c3 = document.createElement('span');
            c3.style.display = 'flex'; c3.style.alignItems = 'center'; c3.style.gap = '4px';
            c3.appendChild(dotWrap);
            c3.appendChild(rep);
            row.appendChild(c3);
            row.appendChild(test);

            sec.appendChild(row);
        }
        return sec;
    }

    function opponentSection() {
        const sec = document.createElement('div');
        sec.className = 'rr-section';
        const h = document.createElement('h4');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = settings.opponent.enabled;
        cb.addEventListener('change', () => { settings.opponent.enabled = cb.checked; save(); });
        h.appendChild(cb);
        h.appendChild(document.createTextNode(settings.opponent.label));
        sec.appendChild(h);

        const note = document.createElement('div');
        note.className = 'rr-note';
        note.textContent = 'Fires once when the opponent\u2019s clock hits 0:00 \u2014 your cue to take the gun.';
        sec.appendChild(note);

        const test = document.createElement('button');
        test.className = 'rr-btn';
        test.textContent = 'Test';
        test.style.marginTop = '6px';
        test.addEventListener('click', () => fireAlert('red', 'Opponent clock test'));
        sec.appendChild(test);
        return sec;
    }

    function winSection() {
        const sec = document.createElement('div');
        sec.className = 'rr-section';
        const h = document.createElement('h4');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = settings.win.enabled;
        cb.addEventListener('change', () => { settings.win.enabled = cb.checked; save(); });
        h.appendChild(cb);
        h.appendChild(document.createTextNode(settings.win.label));
        sec.appendChild(h);

        const note = document.createElement('div');
        note.className = 'rr-note';
        note.textContent = 'Fires once when the opponent shoots themselves and you win the pot.';
        sec.appendChild(note);

        const test = document.createElement('button');
        test.className = 'rr-btn';
        test.textContent = 'Test';
        test.style.marginTop = '6px';
        test.addEventListener('click', () => fireAlert('green', 'Win test'));
        sec.appendChild(test);
        return sec;
    }

    function makeDraggable(el, handle) {
        let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('rr-collapse')) return;
            dragging = true;
            sx = e.clientX; sy = e.clientY;
            const r = el.getBoundingClientRect();
            ox = r.left; oy = r.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const nx = ox + (e.clientX - sx);
            const ny = oy + (e.clientY - sy);
            el.style.left = nx + 'px';
            el.style.top = ny + 'px';
            el.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            const r = el.getBoundingClientRect();
            settings.panel.x = r.left;
            settings.panel.y = r.top;
            save();
        });
    }

    // Unlock audio on first user gesture (browser autoplay policy).
    function primeAudio() {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) { /* ignore */ }
        document.removeEventListener('click', primeAudio);
    }

    // -------------------------------------------------------------------------
    // Boot. Build the panel once, then tick on an interval + observe the DOM.
    // -------------------------------------------------------------------------
    let booted = false;
    function boot() {
        if (booted) return;
        if (!document.body) { setTimeout(boot, 200); return; }
        booted = true;
        originalTitle = document.title;
        buildPanel();
        document.addEventListener('click', primeAudio, { once: false });

        setInterval(tick, 1000);

        const obs = new MutationObserver(() => { /* polling drives tick; observer keeps audio/title responsive on fast changes */ });
        obs.observe(document.body, { childList: true, subtree: true });

        window.addEventListener('visibilitychange', () => {
            if (!document.hidden) originalTitle = document.title.replace(/^\u26A0\uFE0F\s*.*$/, originalTitle);
        });
    }

    boot();

    // Handle SPA navigation in/out of the game hash.
    if (window.onurlchange === null) {
        window.addEventListener('urlchange', () => {
            rearmAll();
        });
    }
    window.addEventListener('hashchange', rearmAll);

})();
