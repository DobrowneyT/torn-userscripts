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

(function() {
    'use strict';

    // Configuration - Replace with your published Google Sheet CSV URL
    const REQUIREMENTS_CSV_URL = 'https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/export?format=csv&id=YOUR_SHEET_ID&gid=0';
    
    // Cache settings
    const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes in milliseconds
    const CACHE_KEY = 'oc_crime_requirements';
    const CACHE_TIMESTAMP_KEY = 'oc_crime_requirements_timestamp';

    const CRIMES_TAB = '#/tab=crimes';
    
    // Fallback data in case the sheet is unavailable
    const FALLBACK_REQUIREMENTS = {
        'Blast from the Past': {'Bomber': 75, 'Engineer': 75, 'Hacker': 70, 'Muscle': 75, 'Picklock #1': 70, 'Picklock #2': 70},
        'Break the Bank': {'Robber': 60, 'Thief #1': 50, 'Thief #2': 65, 'Muscle #1': 60, 'Muscle #2': 60, 'Muscle #3': 65},
        'Stacking the Deck': {'Cat Burglar': 68, 'Driver': 50, 'Imitator': 68, 'Hacker': 68},
        'Ace in the Hole': {'Hacker': 63, 'Driver': 53, 'Imitator': 63, 'Muscle #1': 63, 'Muscle #2': 63},
        'Clinical Precision': {'Cat Burglar': 67, 'Cleaner': 67, 'Imitator': 70, 'Assassin': 67},
        'Bidding War': {'Driver': 75, 'Robber 1': 70, 'Robber 2': 75, 'Robber 3': 75, 'Bomber 1': 70, 'Bomber 2': 75}
    };

    let crimeRequirements = FALLBACK_REQUIREMENTS;

    // Parse CSV data into our requirements object
    function parseCSVToRequirements(csvText) {
        const lines = csvText.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const requirements = {};

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
            const crimeName = values[0];
            
            if (!crimeName) continue;
            
            requirements[crimeName] = {};
            
            // Skip the first column (crime name) and process the rest
            for (let j = 1; j < headers.length && j < values.length; j++) {
                const roleName = headers[j];
                const requirement = values[j];
                
                // Only add non-empty requirements
                if (requirement && !isNaN(requirement) && parseInt(requirement) > 0) {
                    requirements[crimeName][roleName] = parseInt(requirement);
                }
            }
        }
        
        return requirements;
    }

    // Cache management
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

    // Apply requirements to crime roles
    function applyCrimeRequirements() {
        if (window.location.href.indexOf(CRIMES_TAB) === -1) return;

        document.querySelectorAll('[class^=scenario]').forEach(scenario => {
            const titleElement = scenario.querySelector('[class^=panelTitle___]');
            if (!titleElement) return;

            const crimeTitle = titleElement.textContent.trim();
            const requirements = crimeRequirements[crimeTitle];
            
            if (!requirements) return;

            scenario.querySelectorAll('[class^=wrapper___] > [class^=wrapper___]').forEach(role => {
                const slotTitleElement = role.querySelector('[class^=slotHeader___] > [class^=title___]');
                const slotSkillElement = role.querySelector('[class^=slotHeader___] > [class^=successChance___]');
                
                if (!slotTitleElement || !slotSkillElement) return;

                const slotTitle = slotTitleElement.textContent.trim();
                const slotSkill = Number(slotSkillElement.textContent);
                
                if (role.className.indexOf('waitingJoin___') > -1) {
                    const roleRequirement = requirements[slotTitle];
                    
                    if (roleRequirement !== undefined && slotSkill < roleRequirement) {
                        const roleJoinBtn = role.querySelector('[class^=slotBody___] > [class^=joinContainer___] > [class^=joinButtonContainer___] > [class*=joinButton___]');
                        
                        if (roleJoinBtn && !roleJoinBtn.hasAttribute('data-oc-modified')) {
                            roleJoinBtn.setAttribute('disabled', true);
                            roleJoinBtn.textContent = `<${roleRequirement}`;
                            roleJoinBtn.style.color = 'crimson';
                            roleJoinBtn.setAttribute('data-oc-modified', 'true');
                        }
                    }
                }
            });
        });
    }

    // Initialize the script
    async function initialize() {
        console.log('OC Requirements: Initializing...');
        
        // Load requirements (from cache or fetch)
        crimeRequirements = await fetchRequirements();
        
        // Set up observer for DOM changes
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

        const observer = new MutationObserver(function(mutations) {
            let shouldApply = false;
            
            mutations.forEach(mutation => {
                if (String(mutation.target.className).indexOf('description___') > -1) {
                    shouldApply = true;
                }
            });
            
            if (shouldApply) {
                // Small delay to ensure DOM is ready
                setTimeout(applyCrimeRequirements, 100);
            }
        });

        observer.observe(observerTarget, observerConfig);
        
        // Apply requirements immediately if we're already on the crimes tab
        if (window.location.href.indexOf(CRIMES_TAB) > -1) {
            setTimeout(applyCrimeRequirements, 500);
        }
        
        console.log('OC Requirements: Initialized successfully');
    }

    // Force refresh requirements (useful for testing)
    function forceRefresh() {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIMESTAMP_KEY);
        console.log('OC Requirements: Cache cleared, refreshing...');
        initialize();
    }

    // Expose refresh function to console for debugging
    window.ocRefreshRequirements = forceRefresh;

    // Start the script
    initialize();

})();
