// ==UserScript==
// @name         RR Auto Start
// @namespace    MonChoon_
// @version      1.3
// @description  Auto-clicks $ button, Start button, and Yes confirmation for Russian Roulette. Fully event-driven approach for optimal performance.
// @license      MIT
// @author       MonChoon [2250591]
// @match        https://www.torn.com/page.php?sid=russianRoulette*
// @grant        window.onurlchange
// @downloadURL https://github.com/DobrowneyT/torn-userscripts/raw/main/rr-auto-start.user.js
// @updateURL https://github.com/DobrowneyT/torn-userscripts/raw/main/rr-auto-start.user.js
// ==/UserScript==

let inputListenersActive = false;
let confirmationObserver = null;

function initializeAutoStart() {
    setTimeout(() => {
        addAutoStartListener();
    }, 1000);
}

function addAutoStartListener() {
    const dollarButton = document.querySelector('#moneyInput');

    if (dollarButton) {
        dollarButton.removeEventListener('click', autoStartHandler);
        dollarButton.addEventListener('click', autoStartHandler);
    } else {
        setTimeout(addAutoStartListener, 2000);
    }
}

function autoStartHandler(event) {
    if (inputListenersActive) {
        return;
    }

    const inputField = document.querySelector('.input-money');

    if (!inputField) {
        return;
    }

    const initialValue = parseInt(inputField.value) || 0;
    inputListenersActive = true;

    function proceedToStart() {
        const currentValue = parseInt(inputField.value) || 0;

        if (currentValue !== initialValue && currentValue > 0) {
            clickStartButton();
            return true;
        }
        return false;
    }

    function cleanupInputListeners() {
        inputListenersActive = false;
    }

    // Primary method: Check value immediately and with short delays
    // The $ button should update the value almost instantly
    const checkValue = () => {
        if (inputListenersActive && proceedToStart()) {
            cleanupInputListeners();
        }
    };

    // Check immediately (in case it's synchronous)
    setTimeout(checkValue, 0);

    // Check after short delays to catch asynchronous updates
    setTimeout(checkValue, 10);
    setTimeout(checkValue, 25);
    setTimeout(checkValue, 50);

    // Event listeners for manual changes (backup method)
    function createInputListener(inputElement) {
        const listener = function(e) {
            if (proceedToStart()) {
                cleanupInputListeners();
            }
            inputElement.removeEventListener('input', listener);
        };

        inputElement.addEventListener('input', listener);
    }

    function createChangeListener(inputElement) {
        const listener = function(e) {
            if (proceedToStart()) {
                cleanupInputListeners();
            }
            inputElement.removeEventListener('change', listener);
        };

        inputElement.addEventListener('change', listener);
    }

    createInputListener(inputField);
    createChangeListener(inputField);

    // Safety cleanup after 200ms
    setTimeout(() => {
        if (inputListenersActive) {
            cleanupInputListeners();
        }
    }, 200);
}

function clickStartButton() {
    let startButton = document.querySelector('button.submit___Yr2z1.torn-btn');

    if (!startButton) {
        startButton = document.querySelector('button.torn-btn');
        if (startButton && startButton.textContent.toLowerCase().includes('start')) {
            // Found using fallback selector
        } else {
            startButton = null;
        }
    }

    if (startButton) {
        startButton.click();
        waitForConfirmationDialog();
    }
}

function waitForConfirmationDialog() {
    // Clean up any existing observer
    if (confirmationObserver) {
        confirmationObserver.disconnect();
    }

    confirmationObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0) {
                // Check if confirmation dialog appeared
                const yesButton = document.querySelector('button[data-type="confirm"]');
                if (yesButton) {
                    confirmationObserver.disconnect();
                    confirmationObserver = null;
                    yesButton.click();
                }
            }
        });
    });

    // Start observing for the confirmation dialog
    confirmationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Safety cleanup - disconnect observer after 2 seconds if no confirmation found
    setTimeout(() => {
        if (confirmationObserver) {
            confirmationObserver.disconnect();
            confirmationObserver = null;
        }
    }, 2000);
}

function checkAndInitialize() {
    if (window.location.href.includes("page.php?sid=russianRoulette")) {
        const moneyInput = document.querySelector('#moneyInput');
        const inputField = document.querySelector('.input-money');

        if (moneyInput && inputField) {
            initializeAutoStart();
        } else {
            setTimeout(checkAndInitialize, 500);
        }
    }
}

// Initialize when the page loads
if (window.location.href.includes("page.php?sid=russianRoulette")) {
    checkAndInitialize();
}

// Handle URL changes
if (window.onurlchange === null) {
    window.addEventListener('urlchange', () => {
        if (window.location.href.includes("page.php?sid=russianRoulette")) {
            setTimeout(checkAndInitialize, 300);
        }
    });
}

// Handle regular page loads
window.addEventListener('load', () => {
    if (window.location.href.includes("page.php?sid=russianRoulette")) {
        checkAndInitialize();
    }
});

// Handle dynamic content loading
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
            const moneyInput = document.querySelector('#moneyInput');
            if (moneyInput && !moneyInput.hasAttribute('data-auto-start-listener')) {
                moneyInput.setAttribute('data-auto-start-listener', 'true');
                addAutoStartListener();
            }
        }
    });
});

// Start observing
observer.observe(document.body, {
    childList: true,
    subtree: true
});
