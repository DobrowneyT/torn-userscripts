// ==UserScript==
// @name         OC 2.0 TNL-Forge Role Requirements
// @namespace    MonChoon_
// @version      2.0
// @description  Torn OC 2.0 Requirements for Roles in Specific Crimes, based on TNL Forge
// @license      MIT
// @author       MonChoon [2250591], Silmaril [2665762]
// @match        https://www.torn.com/factions.php?step=your*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @downloadURL https://github.com/DobrowneyT/torn-userscripts/raw/main/OC-2-TNL-Forge-reqs.js
// @updateURL https://github.com/DobrowneyT/torn-userscripts/raw/main/OC-2-TNL-Forge-reqs.js
// ==/UserScript==

// Configuration and global variables
const REQUIREMENTS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSb0W9iwm3noNzJVoUArG4VSbeSzpgWlMB9ObhYxU8FdNMzWEhIC852N2SHSWbb-pKFdrBgMwxQr6x-/pub?gid=812446557&single=true&output=csv';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds
const CACHE_KEY = 'oc_crime_requirements';
const CACHE_TIMESTAMP_KEY = 'oc_crime_requirements_timestamp';
const CRIMES_TAB = '#/tab=crimes';

// Fallback data in case Google Sheets is unavailable
const FALLBACK_REQUIREMENTS = {
    'Blast from the Past': {'Bomber': 75, 'Engineer': 75, 'Hacker': 70, 'Muscle': 75, 'Picklock #1': 70, 'Picklock #2': 70},
    'Break the Bank': {'Robber': 60, 'Thief #1': 50, 'Thief #2': 65, 'Muscle #1': 60, 'Muscle #2': 60, 'Muscle #3': 65},
    'Stacking the Deck': {'Cat Burglar': 68, 'Driver': 50, 'Imitator': 68, 'Hacker': 68},
    'Ace in the Hole': {'Hacker': 63, 'Driver': 53, 'Imitator': 63, 'Muscle #1': 63, 'Muscle #2': 63},
    'Clinical Precision': {'Cat Burglar': 67, 'Cleaner': 67, 'Imitator': 70, 'Assassin': 67},
    'Bidding War': {'Driver': 75, 'Robber 1': 70, 'Robber 2': 75, 'Robber 3': 75, 'Bomber 1': 70, 'Bomber 2': 75}
};

let crimeRequirements = FALLBACK_REQUIREMENTS;
let observer = null;

// Parse CSV data (two-row format: Crime row, Role row, CPR row)
function parseCSVToRequirements(csvText) {
    const lines = csvText.trim().split('\n');
    const requirements = {};

    // Process in groups of 3 lines (Crime, Role, CPR)
    for (let i = 0; i < lines.length; i += 3) {
        if (i + 2 >= lines.length) break;

        const crimeRow = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const roleRow = lines[i + 1].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const cprRow = lines[i + 2].split(',').map(v => v.trim().replace(/^"|"$/g, ''));

        // First cell should be "Crime", second cell is the crime name
        if (crimeRow[0] !== 'Crime' || !crimeRow[1]) continue;

        const crimeName = crimeRow[1];
        requirements[crimeName] = {};

        // Process roles (skip first column which is "Role" or "CPR")
        for (let j = 1; j < roleRow.length && j < cprRow.length; j++) {
            const roleName = roleRow[j];
            const cprValue = cprRow[j];

            if (roleName && cprValue && !isNaN(cprValue)) {
                const cpr = parseInt(cprValue);
                if (cpr >= 0) { // Allow 0 values for roles like "Picklock #2"
                    requirements[crimeName][roleName] = cpr;
                }
            }
        }
    }

    return requirements;
}

// Cache management functions
function getCachedRequirements() {
    try {
        const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
        const cached = localStorage.getItem(CACHE_KEY);

        if (timestamp && cached) {
            const cacheAge = Date.now() - parseInt(timestamp);
            if (cacheAge < CACHE_DURATION) {
                console.log('OC Requirements: Using cached data');
                return JSON.parse(cached);
            }
        }
    } catch (e) {
        console.warn('OC Requirements: Error reading cache:', e);
    }
    return null;
}

function setCachedRequirements(requirements) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(requirements));
        localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch (e) {
        console.warn('OC Requirements: Error setting cache:', e);
    }
}

// Fetch requirements from Google Sheets
function fetchRequirements() {
    return new Promise((resolve) => {
        // Check cache first
        const cached = getCachedRequirements();
        if (cached) {
            resolve(cached);
            return;
        }

        console.log('OC Requirements: Fetching from Google Sheets...');

        GM_xmlhttpRequest({
            method: 'GET',
            url: REQUIREMENTS_CSV_URL,
            timeout: 10000,
            onload: function(response) {
                try {
                    if (response.status === 200) {
                        const requirements = parseCSVToRequirements(response.responseText);
                        setCachedRequirements(requirements);
                        console.log('OC Requirements: Successfully loaded from Google Sheets');
                        console.log('Loaded crimes:', Object.keys(requirements));
                        resolve(requirements);
                    } else {
                        throw new Error(`HTTP ${response.status}`);
                    }
                } catch (e) {
                    console.warn('OC Requirements: Error parsing CSV, using fallback:', e);
                    resolve(FALLBACK_REQUIREMENTS);
                }
            },
            onerror: function(error) {
                console.warn('OC Requirements: Network error, using fallback:', error);
                resolve(FALLBACK_REQUIREMENTS);
            },
            ontimeout: function() {
                console.warn('OC Requirements: Timeout, using fallback');
                resolve(FALLBACK_REQUIREMENTS);
            }
        });
    });
}

// Set up the mutation observer for dynamic content
function setupObserver() {
    const observerTarget = document.querySelector("#faction-crimes");
    if (!observerTarget) {
        console.warn('OC Requirements: Faction crimes element not found');
        return;
    }

    const observerConfig = {
        attributes: false,
        childList: true,
        characterData: false,
        subtree: true
    };

    observer = new MutationObserver(function(mutations) {
        mutations.forEach(mutationRaw => {
            if (window.location.href.indexOf(CRIMES_TAB) > -1){
                let mutation = mutationRaw.target;
                if (String(mutation.className).indexOf('description___') > -1){
                    let crimeParentRow = mutation.parentNode.parentNode.parentNode;
                    let crimeTitle = crimeParentRow.querySelector('[class^=scenario] > [class^=wrapper___] > [class^=panel___] > [class^=panelTitle___]').textContent;
                    let crimeTitleRequirements = crimeRequirements[crimeTitle];
                    if (crimeTitleRequirements === undefined) return;
                    crimeParentRow.querySelectorAll('[class^=wrapper___] > [class^=wrapper___]').forEach(crime => {
                        let slotTitle = crime.querySelector('[class^=slotHeader___] > [class^=title___]').textContent;
                        let slotSkill = Number(crime.querySelector('[class^=slotHeader___] > [class^=successChance___]').textContent);
                        if (crime.className.indexOf('waitingJoin___') > -1){
                            let roleRequirement = crimeTitleRequirements[slotTitle];
                            if (roleRequirement !== undefined){
                                if (slotSkill < roleRequirement){
                                    let roleJoinBtn = crime.querySelector('[class^=slotBody___] > [class^=joinContainer___] > [class^=joinButtonContainer___] > [class*=joinButton___]');
                                    if (roleJoinBtn && !roleJoinBtn.hasAttribute('data-oc-modified')) {
                                        roleJoinBtn.setAttribute('disabled', true);
                                        roleJoinBtn.textContent = `<${roleRequirement}`;
                                        roleJoinBtn.style.color = 'crimson';
                                        roleJoinBtn.setAttribute('data-oc-modified', 'true');
                                    }
                                }
                            }
                        }
                    });
                }
            }
        });
    });

    observer.observe(observerTarget, observerConfig);
    console.log('OC Requirements: Observer set up successfully');
}

// Apply requirements to existing crimes on page load
function applyToExistingCrimes() {
    if (window.location.href.indexOf(CRIMES_TAB) === -1) return;

    // Find all crime containers and process them like the observer does
    document.querySelectorAll('[class^=scenario]').forEach(scenario => {
        try {
            // Use the exact same selector as the observer
            let crimeTitle = scenario.querySelector('[class^=wrapper___] > [class^=panel___] > [class^=panelTitle___]').textContent;
            let crimeTitleRequirements = crimeRequirements[crimeTitle];
            if (crimeTitleRequirements === undefined) return;

            // Get the parent container (equivalent to crimeParentRow in observer)
            let crimeParentRow = scenario.parentNode || scenario;

            crimeParentRow.querySelectorAll('[class^=wrapper___] > [class^=wrapper___]').forEach(crime => {
                let slotTitle = crime.querySelector('[class^=slotHeader___] > [class^=title___]').textContent;
                let slotSkill = Number(crime.querySelector('[class^=slotHeader___] > [class^=successChance___]').textContent);
                if (crime.className.indexOf('waitingJoin___') > -1){
                    let roleRequirement = crimeTitleRequirements[slotTitle];
                    if (roleRequirement !== undefined){
                        if (slotSkill < roleRequirement){
                            let roleJoinBtn = crime.querySelector('[class^=slotBody___] > [class^=joinContainer___] > [class^=joinButtonContainer___] > [class*=joinButton___]');
                            if (roleJoinBtn && !roleJoinBtn.hasAttribute('data-oc-modified')) {
                                roleJoinBtn.setAttribute('disabled', true);
                                roleJoinBtn.textContent = `<${roleRequirement}`;
                                roleJoinBtn.style.color = 'crimson';
                                roleJoinBtn.setAttribute('data-oc-modified', 'true');
                            }
                        }
                    }
                }
            });
        } catch (e) {
            console.log('Error processing crime on page load:', e);
        }
    });
}

// Debug function to show current state
function debugInfo() {
    console.log('=== OC Requirements Debug Info ===');
    console.log('Script loaded:', true);
    console.log('Current URL:', window.location.href);
    console.log('On crimes tab:', window.location.href.indexOf(CRIMES_TAB) > -1);
    console.log('Cache timestamp:', localStorage.getItem(CACHE_TIMESTAMP_KEY));
    console.log('Requirements loaded:', Object.keys(crimeRequirements).length, 'crimes');
    console.log('Requirements:', crimeRequirements);
    console.log('Faction crimes element exists:', !!document.querySelector("#faction-crimes"));

    // Test selectors
    console.log('Found scenarios:', document.querySelectorAll('[class^=scenario]').length);
    console.log('Found join buttons:', document.querySelectorAll('[class*=joinButton___]').length);
    console.log('Found waiting join slots:', document.querySelectorAll('[class*=waitingJoin___]').length);

    const cached = getCachedRequirements();
    if (cached) {
        console.log('Cached data available:', Object.keys(cached).length, 'crimes');
    } else {
        console.log('No cached data');
    }

    console.log('===================================');
}

// Force refresh requirements (useful for testing)
function forceRefresh() {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    console.log('OC Requirements: Cache cleared, refreshing...');

    // Re-initialize to fetch fresh data
    initialize();
}

// Test function
function testScript() {
    console.log('OC Requirements script is loaded and working!');
    debugInfo();
}

// Main initialization function
async function initialize() {
    console.log('OC Requirements: Initializing...');

    // Load requirements (from cache or fetch)
    crimeRequirements = await fetchRequirements();

    // Set up observer for DOM changes
    setupObserver();

    // Apply requirements immediately if we're already on the crimes tab
    if (window.location.href.indexOf(CRIMES_TAB) > -1) {
        setTimeout(applyToExistingCrimes, 500);
    }

    console.log('OC Requirements: Initialized successfully');
}

// Expose functions to console for debugging
window.ocRefreshRequirements = forceRefresh;
window.ocDebugInfo = debugInfo;
window.ocTest = testScript;

// Log that the script has loaded
console.log('OC Requirements: Script loaded successfully');
console.log('Available debug commands: ocTest(), ocDebugInfo(), ocRefreshRequirements()');

// Start the script
initialize();
