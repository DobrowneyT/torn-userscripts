// ==UserScript==
// @name         [FORGE] OC 2.0 Role Requirements
// @namespace    MonChoon_
// @version      4.5
// @description  Torn OC 2.0 Requirements with visual indicators - reads CPR requirements from a published Google Sheet
// @license      MIT
// @author       MonChoon [2250591], xentac[3354782], underko[3362751]
// @match        https://www.torn.com/factions.php?step=your*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      docs.google.com
// @connect      googleusercontent.com
// @connect      doc-*.sheets.googleusercontent.com
// @downloadURL  https://github.com/DobrowneyT/torn-userscripts/raw/main/OC-2-TNL-Forge-reqs.js
// @updateURL    https://github.com/DobrowneyT/torn-userscripts/raw/main/OC-2-TNL-Forge-reqs.js
// ==/UserScript==

(function() {
    'use strict';

    const REQUIREMENTS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSb0W9iwm3noNzJVoUArG4VSbeSzpgWlMB9ObhYxU8FdNMzWEhIC852N2SHSWbb-pKFdrBgMwxQr6x-/pub?gid=812446557&single=true&output=csv';
    const CACHE_DURATION = 5 * 60 * 1000;
    const DEFAULT_CPR = 75;
    const YELLOW_THRESHOLD = 5;

    const FALLBACK_REQUIREMENTS = {
        'Blast from the Past':  { 'Bomber': 75, 'Engineer': 75, 'Hacker': 70, 'Muscle': 75, 'Picklock #1': 70, 'Picklock #2': 70 },
        'Break the Bank':       { 'Robber': 60, 'Thief #1': 50, 'Thief #2': 65, 'Muscle #1': 60, 'Muscle #2': 60, 'Muscle #3': 65 },
        'Stacking the Deck':    { 'Cat Burglar': 68, 'Driver': 50, 'Imitator': 68, 'Hacker': 68 },
        'Ace in the Hole':      { 'Hacker': 63, 'Driver': 53, 'Imitator': 63, 'Muscle #1': 63, 'Muscle #2': 63 },
        'Clinical Precision':   { 'Cat Burglar': 67, 'Cleaner': 67, 'Imitator': 70, 'Assassin': 67 },
        'Bidding War':          { 'Driver': 75, 'Robber #1': 70, 'Robber #2': 75, 'Robber #3': 75, 'Bomber #1': 70, 'Bomber #2': 75 },
        'Honey Trap':           { 'Muscle': 75, 'Enforcer': 75 }
    };

    let ocRequirements = FALLBACK_REQUIREMENTS;
    let crimeData = {};
    let previousTab = 'none';
    let isInitialized = false;

    function getStoredValue(key, defaultValue = null) {
        try {
            if (typeof GM_getValue !== 'undefined') return GM_getValue(key, defaultValue);
            const stored = localStorage.getItem(key);
            return stored ? JSON.parse(stored) : defaultValue;
        } catch (e) { return defaultValue; }
    }

    function setStoredValue(key, value) {
        try {
            if (typeof GM_setValue !== 'undefined') { GM_setValue(key, value); return; }
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {}
    }

    function parseCSV(csvText) {
        try {
            const lines = csvText.trim().split('\n');
            if (lines.length < 2) return null;
            const requirements = {};
            let rowsParsed = 0;
            for (let i = 1; i < lines.length; i++) {
                const cells = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                const crime = cells[0], role = cells[1], cpr = parseInt(cells[2], 10);
                if (!crime || !role || isNaN(cpr)) continue;
                if (!requirements[crime]) requirements[crime] = {};
                requirements[crime][role] = cpr;
                rowsParsed++;
            }
            console.log(`[FORGE OC] Parsed ${rowsParsed} rows across ${Object.keys(requirements).length} crimes`);
            return Object.keys(requirements).length > 0 ? requirements : null;
        } catch (e) { console.log('[FORGE OC] CSV parse error:', e.message); return null; }
    }

    function getCachedRequirements() {
        const timestamp = getStoredValue('forge_oc_cache_timestamp', 0);
        const cached    = getStoredValue('forge_oc_cache_data', null);
        if (timestamp && cached && (Date.now() - timestamp) < CACHE_DURATION) return cached;
        return null;
    }

    function setCachedRequirements(data) {
        setStoredValue('forge_oc_cache_timestamp', Date.now());
        setStoredValue('forge_oc_cache_data', data);
    }

    function fetchRequirements() {
        return new Promise((resolve) => {
            const cached = getCachedRequirements();
            if (cached) { console.log('[FORGE OC] Using cached requirements'); resolve(cached); return; }
            console.log('[FORGE OC] Fetching requirements from Google Sheets...');

            function handleCSVResponse(text) {
                const parsed = parseCSV(text);
                if (parsed) { console.log('[FORGE OC] Sheet fetch successful:', Object.keys(parsed)); setCachedRequirements(parsed); resolve(parsed); return true; }
                return false;
            }
            function useFallback() { console.log('[FORGE OC] Using hardcoded fallback requirements'); resolve(FALLBACK_REQUIREMENTS); }

            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'GET', url: REQUIREMENTS_CSV_URL, timeout: 10000,
                    onload:    (r) => { if (r.status === 200 && r.responseText && handleCSVResponse(r.responseText)) return; tryFetch(handleCSVResponse, useFallback); },
                    onerror:   () => tryFetch(handleCSVResponse, useFallback),
                    ontimeout: () => tryFetch(handleCSVResponse, useFallback)
                });
            } else { tryFetch(handleCSVResponse, useFallback); }
        });
    }

    function tryFetch(onSuccess, onFail) {
        if (typeof fetch === 'undefined') { onFail(); return; }
        fetch(REQUIREMENTS_CSV_URL, { method: 'GET', mode: 'cors', cache: 'no-cache' })
            .then(r => r.ok ? r.text() : Promise.reject('status ' + r.status))
            .then(text => { if (!onSuccess(text)) onFail(); })
            .catch(() => onFail());
    }

    function getRequirement(crimeName, roleName) {
        const crime = ocRequirements[crimeName];
        if (!crime) return DEFAULT_CPR;
        const cpr = crime[roleName];
        return (cpr !== undefined) ? cpr : DEFAULT_CPR;
    }

    function processCrime(wrapper) {
        const ocId = wrapper.getAttribute('data-oc-id');
        if (!ocId) return;

        // If already processed WITH roles, skip
        if (crimeData[ocId] && crimeData[ocId].roles.length > 0) return;

        const titleEl = wrapper.querySelector('[class*="panelTitle"]');
        if (!titleEl) return;

        const crimeTitle = titleEl.textContent.trim();
        const roles = [];

        const roleEls = wrapper.querySelectorAll('span[class^="title___"], span[class*=" title___"]');
        roleEls.forEach((roleEl) => {
            const roleName = roleEl.textContent.trim();

            const slotHeader = roleEl.closest('[class*="slotHeader"]');
            const successEl  = slotHeader
                ? slotHeader.querySelector('[class*="successChance"]')
                : null;

            const chance = successEl ? parseInt(successEl.textContent.trim(), 10) : null;
            const requirement = getRequirement(crimeTitle, roleName);
            roles.push({ role: roleName, chance, requirement });

            if (chance === null || isNaN(chance)) return;

            successEl.textContent = `${chance}/${requirement}`;

            if (!slotHeader) return;

            const deficit = requirement - chance;
            if (deficit <= 0) {
                slotHeader.style.backgroundColor = '#239b56';
            } else if (deficit <= YELLOW_THRESHOLD) {
                slotHeader.style.backgroundColor = '#b7950b';
            } else {
                slotHeader.style.backgroundColor = '#a93226';
            }
        });

        // Only mark as processed if we actually found roles
        if (roles.length > 0) {
            crimeData[ocId] = { id: ocId, title: crimeTitle, roles };
        }
    }

    function getActiveTabTitle() {
        // Find tabName spans and check which one's parent button has 'active' in its class
        const spans = document.querySelectorAll('span[class*="tabName"]');
        for (const span of spans) {
            const btn = span.closest('button');
            if (btn && btn.className.includes('active')) return span.textContent.trim();
        }
        return '';
    }

    function scanCrimes() {
        const tabTitle = getActiveTabTitle();
        // Only process on Recruiting or Planning tabs
        if (tabTitle !== 'Recruiting' && tabTitle !== 'Planning') return;
        if (previousTab !== tabTitle) { crimeData = {}; previousTab = tabTitle; }
        const crimes = document.querySelectorAll('[data-oc-id]');
        if (crimes.length > 0 && Object.keys(crimeData).length === 0) {
            console.log(`[FORGE OC] Processing ${crimes.length} crimes on "${tabTitle}" tab`);
        }
        crimes.forEach(processCrime);
    }

    function setupMutationObserver(root) {
        const observer = new MutationObserver(scanCrimes);
        observer.observe(root, { childList: true, subtree: true });
        console.log('[FORGE OC] Observer active');

        // Run an immediate scan in case crimes are already rendered
        scanCrimes();
    }

    function waitForElement(selector, callback, interval = 300, maxAttempts = 100) {
        let attempts = 0;
        const check = () => {
            const el = document.querySelector(selector);
            if (el) { callback(el); return; }
            if (++attempts < maxAttempts) setTimeout(check, interval);
        };
        check();
    }

    async function initialize() {
        if (isInitialized) return;
        isInitialized = true;
        console.log('[FORGE OC] Initializing v4.5...');
        ocRequirements = await fetchRequirements();
        console.log('[FORGE OC] Loaded requirements for', Object.keys(ocRequirements).length, 'crimes');
        waitForElement('#faction-crimes-root', (root) => {
            setupMutationObserver(root);
            console.log('[FORGE OC] Ready');
        });
    }

    window.forgeOcRefresh = function() {
        console.log('[FORGE OC] Forcing refresh...');
        setStoredValue('forge_oc_cache_timestamp', 0);
        crimeData = {}; isInitialized = false; initialize();
    };

    window.forgeOcDiagnostics = function() {
        console.log('=== FORGE OC v4.5 DIAGNOSTICS ===');
        console.log('Requirements loaded:', Object.keys(ocRequirements).length, 'crimes');

        // Tab detection
        const tabResult = getActiveTabTitle();
        console.log('Active tab:', JSON.stringify(tabResult));
        const allTabSpans = document.querySelectorAll('span[class*="tabName"]');
        console.log('All tabName spans:', allTabSpans.length);
        allTabSpans.forEach(s => {
            const btn = s.closest('button');
            const isActive = btn && btn.className.includes('active');
            console.log(`  "${s.textContent.trim()}" active=${isActive} btnClass="${btn?.className}"`);
        });

        // Crime wrappers
        const crimes = document.querySelectorAll('[data-oc-id]');
        console.log('Crime wrappers [data-oc-id]:', crimes.length);
        console.log('Already processed:', Object.keys(crimeData).length);

        // Detailed per-crime analysis
        crimes.forEach((c, i) => {
            if (i > 2) { if (i === 3) console.log('  ... (truncated)'); return; }
            const ocId = c.getAttribute('data-oc-id');
            const title = c.querySelector('[class*="panelTitle"]');
            const roleSpans = c.querySelectorAll('span[class^="title___"], span[class*=" title___"]');
            console.log(`  OC ${ocId}: title="${title?.textContent.trim()}" roles=${roleSpans.length}`);
            roleSpans.forEach(r => {
                const sh = r.closest('[class*="slotHeader"]');
                const sc = sh?.querySelector('[class*="successChance"]');
                console.log(`    ${r.textContent.trim()} | header=${!!sh} | chance="${sc?.textContent.trim()}"`);
            });
        });

        console.log('============================');
    };

    console.log('[FORGE OC] Script loaded. Commands: forgeOcRefresh(), forgeOcDiagnostics()');
    initialize();

})();
