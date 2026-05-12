// ==UserScript==
// @name         [FORGE] OC 2.0 Role Requirements
// @namespace    MonChoon_
// @version      4.1
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
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    const DEFAULT_CPR = 75; // Default requirement for any crime/role not listed in the sheet
    const YELLOW_THRESHOLD = 5; // CPR within this many points below requirement = yellow
    // ==========================================================================

    // Hardcoded fallback if sheet is unreachable
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

    // ==================== STORAGE HELPERS ====================

    function getStoredValue(key, defaultValue = null) {
        try {
            if (typeof GM_getValue !== 'undefined') {
                return GM_getValue(key, defaultValue);
            }
            const stored = localStorage.getItem(key);
            return stored ? JSON.parse(stored) : defaultValue;
        } catch (e) {
            return defaultValue;
        }
    }

    function setStoredValue(key, value) {
        try {
            if (typeof GM_setValue !== 'undefined') {
                GM_setValue(key, value);
                return;
            }
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            // Silent fail
        }
    }

    // ==================== CSV PARSING ====================

    /**
     * Parse the flat CSV format: Crime,Role,CPR,Difficulty
     * One row per crime+role combination, with a header row
     */
    function parseCSV(csvText) {
        try {
            const lines = csvText.trim().split('\n');
            if (lines.length < 2) return null; // Need header + at least one data row

            const requirements = {};
            let rowsParsed = 0;

            // Skip header (line 0), process data rows
            for (let i = 1; i < lines.length; i++) {
                const cells = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                const crime = cells[0];
                const role = cells[1];
                const cpr = parseInt(cells[2], 10);

                if (!crime || !role || isNaN(cpr)) continue;

                if (!requirements[crime]) {
                    requirements[crime] = {};
                }
                requirements[crime][role] = cpr;
                rowsParsed++;
            }

            console.log(`[FORGE OC] Parsed ${rowsParsed} rows across ${Object.keys(requirements).length} crimes`);
            return Object.keys(requirements).length > 0 ? requirements : null;
        } catch (e) {
            console.log('[FORGE OC] CSV parse error:', e.message);
            return null;
        }
    }

    // ==================== FETCHING ====================

    function getCachedRequirements() {
        const timestamp = getStoredValue('forge_oc_cache_timestamp', 0);
        const cached = getStoredValue('forge_oc_cache_data', null);
        if (timestamp && cached && (Date.now() - timestamp) < CACHE_DURATION) {
            return cached;
        }
        return null;
    }

    function setCachedRequirements(data) {
        setStoredValue('forge_oc_cache_timestamp', Date.now());
        setStoredValue('forge_oc_cache_data', data);
    }

    function fetchRequirements() {
        return new Promise((resolve) => {
            // Check cache first
            const cached = getCachedRequirements();
            if (cached) {
                console.log('[FORGE OC] Using cached requirements');
                resolve(cached);
                return;
            }

            console.log('[FORGE OC] Fetching requirements from Google Sheets...');

            function handleCSVResponse(text) {
                const parsed = parseCSV(text);
                if (parsed) {
                    console.log('[FORGE OC] Sheet fetch successful:', Object.keys(parsed));
                    setCachedRequirements(parsed);
                    resolve(parsed);
                    return true;
                }
                return false;
            }

            function useFallback() {
                console.log('[FORGE OC] Using hardcoded fallback requirements');
                resolve(FALLBACK_REQUIREMENTS);
            }

            // Try GM_xmlhttpRequest first (works cross-origin in Tampermonkey)
            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: REQUIREMENTS_CSV_URL,
                    timeout: 10000,
                    onload: function(response) {
                        if (response.status === 200 && response.responseText) {
                            if (handleCSVResponse(response.responseText)) return;
                        }
                        console.log('[FORGE OC] GM_xmlhttpRequest failed, status:', response.status);
                        // Try fetch as backup
                        tryFetch(handleCSVResponse, useFallback);
                    },
                    onerror: function() {
                        tryFetch(handleCSVResponse, useFallback);
                    },
                    ontimeout: function() {
                        tryFetch(handleCSVResponse, useFallback);
                    }
                });
            } else {
                tryFetch(handleCSVResponse, useFallback);
            }
        });
    }

    function tryFetch(onSuccess, onFail) {
        if (typeof fetch === 'undefined') { onFail(); return; }

        fetch(REQUIREMENTS_CSV_URL, { method: 'GET', mode: 'cors', cache: 'no-cache' })
            .then(r => r.ok ? r.text() : Promise.reject('status ' + r.status))
            .then(text => { if (!onSuccess(text)) onFail(); })
            .catch(() => onFail());
    }

    // ==================== CRIME PROCESSING ====================

    /**
     * Get the CPR requirement for a specific crime + role
     * Falls back to DEFAULT_CPR if the crime or role isn't listed
     */
    function getRequirement(crimeName, roleName) {
        const crime = ocRequirements[crimeName];
        if (!crime) return DEFAULT_CPR;
        const cpr = crime[roleName];
        return (cpr !== undefined) ? cpr : DEFAULT_CPR;
    }

    /**
     * Process a single crime wrapper element and apply visual indicators
     */
    function processCrime(wrapper) {
        const ocId = wrapper.getAttribute('data-oc-id');
        if (!ocId || crimeData[ocId]) return;

        // Get the crime title
        const titleEl = wrapper.querySelector('p.panelTitle___aoGuV');
        if (!titleEl) return;

        const crimeTitle = titleEl.textContent.trim();
        const roles = [];

        // Find all role slots in this crime
        const roleEls = wrapper.querySelectorAll('.title___UqFNy');
        roleEls.forEach((roleEl) => {
            const roleName = roleEl.textContent.trim();

            // Find the success chance element (sibling after the role title)
            const successEl = roleEl.nextElementSibling;
            const chance = successEl ? parseInt(successEl.textContent.trim(), 10) : null;

            const requirement = getRequirement(crimeTitle, roleName);
            roles.push({ role: roleName, chance, requirement });

            // Skip if no chance value available
            if (chance === null || isNaN(chance)) return;

            // Update the displayed text to show "current/required"
            successEl.textContent = `${chance}/${requirement}`;

            // Color-code the slot header: green / yellow / red
            const slotHeader = roleEl.closest('button.slotHeader___K2BS_');
            if (!slotHeader) return;

            const deficit = requirement - chance;

            if (deficit <= 0) {
                // Meets or exceeds requirement - green
                slotHeader.style.backgroundColor = '#239b56';
            } else if (deficit <= YELLOW_THRESHOLD) {
                // Within threshold below requirement - yellow/amber
                slotHeader.style.backgroundColor = '#b7950b';
            } else {
                // More than threshold below requirement - red
                slotHeader.style.backgroundColor = '#a93226';
            }
        });

        crimeData[ocId] = { id: ocId, title: crimeTitle, roles };
    }

    // ==================== OBSERVER ====================

    function setupMutationObserver(root) {
        const observer = new MutationObserver(() => {
            const tabTitle = document.querySelector('button.active___ImR61 span.tabName___DdwH3')?.textContent.trim();
            if (tabTitle !== 'Recruiting' && tabTitle !== 'Planning') return;

            // Reset tracked crimes when switching tabs
            if (previousTab !== tabTitle) {
                crimeData = {};
                previousTab = tabTitle;
            }

            const allCrimes = document.querySelectorAll('.wrapper___U2Ap7');
            allCrimes.forEach(processCrime);
        });

        observer.observe(root, { childList: true, subtree: true });
        console.log('[FORGE OC] Observer active');
    }

    // ==================== WAIT FOR ELEMENT ====================

    function waitForElement(selector, callback, interval = 300, maxAttempts = 100) {
        let attempts = 0;
        const check = () => {
            const el = document.querySelector(selector);
            if (el) {
                callback(el);
                return;
            }
            attempts++;
            if (attempts < maxAttempts) {
                setTimeout(check, interval);
            }
        };
        check();
    }

    // ==================== INIT ====================

    async function initialize() {
        if (isInitialized) return;
        isInitialized = true;

        console.log('[FORGE OC] Initializing v4.1...');

        ocRequirements = await fetchRequirements();
        console.log('[FORGE OC] Loaded requirements for', Object.keys(ocRequirements).length, 'crimes');

        waitForElement('#faction-crimes-root', (root) => {
            setupMutationObserver(root);
            console.log('[FORGE OC] Ready');
        });
    }

    // Expose utilities for console debugging
    window.forgeOcRefresh = function() {
        console.log('[FORGE OC] Forcing refresh...');
        setStoredValue('forge_oc_cache_timestamp', 0);
        crimeData = {};
        isInitialized = false;
        initialize();
    };

    window.forgeOcDiagnostics = function() {
        console.log('=== FORGE OC DIAGNOSTICS ===');
        console.log('Requirements loaded:', Object.keys(ocRequirements).length, 'crimes');
        for (const [crime, roles] of Object.entries(ocRequirements)) {
            console.log(` ${crime}:`, roles);
        }
        console.log('Crimes tracked this session:', Object.keys(crimeData).length);
        console.log('CSV URL:', REQUIREMENTS_CSV_URL);
        console.log('============================');
    };

    console.log('[FORGE OC] Script loaded. Commands: forgeOcRefresh(), forgeOcDiagnostics()');
    initialize();

})();
