// ==UserScript==
// @name         Faction Bank Auto Deposit
// @namespace    MonChoon_
// @version      1.0
// @description  Auto-clicks $ button, DEPOSIT MONEY button, and Yes confirmation for faction bank deposits.
// @license      MIT
// @author       MonChoon [2250591]
// @match        https://www.torn.com/factions.php*
// @grant        window.onurlchange
// @downloadURL https://github.com/DobrowneyT/torn-userscripts/raw/main/faction-bank-auto-deposit.user.js
// @updateURL https://github.com/DobrowneyT/torn-userscripts/raw/main/faction-bank-auto-deposit.user.js
// ==/UserScript==

let inputListenersActive = false;
let confirmationObserver = null;

function initializeAutoDeposit() {
    setTimeout(() => {
        addAutoDepositListener();
    }, 1000);
}

function addAutoDepositListener() {
    // Find the cash deposit section specifically
    const cashSection = document.querySelector('.cash.left');
    if (!cashSection) {
        console.log("Faction Bank Auto Deposit: Cash section not found, retrying...");
        setTimeout(addAutoDepositListener, 2000);
        return;
    }

    const dollarButton = cashSection.querySelector('.input-money-symbol');

    if (dollarButton) {
        dollarButton.removeEventListener('click', autoDepositHandler);
        dollarButton.addEventListener('click', autoDepositHandler);
    } else {
        console.log("Faction Bank Auto Deposit: $ button not found, retrying...");
        setTimeout(addAutoDepositListener, 2000);
    }
}

function autoDepositHandler(event) {
    if (inputListenersActive) {
        return;
    }

    // Get the cash section and input fields
    const cashSection = document.querySelector('.cash.left');
    if (!cashSection) {
        console.log("Faction Bank Auto Deposit ERROR: Cash section not found!");
        return;
    }

    const inputFields = cashSection.querySelectorAll('.amount.input-money');
    const inputVisible = inputFields[0]; // type="text"
    const inputHidden = inputFields[1];  // type="hidden"

    if (!inputVisible || !inputHidden) {
        console.log("Faction Bank Auto Deposit ERROR: Could not find input fields!");
        return;
    }

    const initialValue = parseInt(inputHidden.value) || 0;
    inputListenersActive = true;

    function proceedToDeposit() {
        const currentValue = parseInt(inputHidden.value) || 0;

        if (currentValue !== initialValue && currentValue > 0) {
            clickDepositButton();
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
        if (inputListenersActive && proceedToDeposit()) {
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
            if (proceedToDeposit()) {
                cleanupInputListeners();
            }
            inputElement.removeEventListener('input', listener);
        };

        inputElement.addEventListener('input', listener);
    }

    function createChangeListener(inputElement) {
        const listener = function(e) {
            if (proceedToDeposit()) {
                cleanupInputListeners();
            }
            inputElement.removeEventListener('change', listener);
        };

        inputElement.addEventListener('change', listener);
    }

    createInputListener(inputVisible);
    createInputListener(inputHidden);
    createChangeListener(inputVisible);
    createChangeListener(inputHidden);

    // Safety cleanup after 200ms
    setTimeout(() => {
        if (inputListenersActive) {
            cleanupInputListeners();
        }
    }, 200);
}

function clickDepositButton() {
    // Find the cash section first
    const cashSection = document.querySelector('.cash.left');
    if (!cashSection) {
        console.log("Faction Bank Auto Deposit ERROR: Cash section not found for deposit button!");
        return;
    }

    // Look for the DEPOSIT MONEY button within the cash section
    let depositButton = cashSection.querySelector('button.torn-btn');

    // Verify it's the correct button by checking text content
    if (depositButton && depositButton.textContent.includes('DEPOSIT MONEY')) {
        depositButton.click();
        waitForConfirmationDialog();
    } else {
        console.log("Faction Bank Auto Deposit ERROR: DEPOSIT MONEY button not found or text doesn't match!");
    }
}

function waitForConfirmationDialog() {
    // Clean up any existing observer
    if (confirmationObserver) {
        confirmationObserver.disconnect();
    }

    confirmationObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.addedNodes.length > 0 || mutation.type === 'attributes') {
                // Check if confirmation dialog appeared (it becomes visible with display: block)
                const confirmDialog = document.querySelector('.cash-confirm.left');
                if (confirmDialog && confirmDialog.style.display === 'block') {
                    const yesButton = confirmDialog.querySelector('a.yes.bold.t-blue.h.c-pointer');
                    if (yesButton) {
                        confirmationObserver.disconnect();
                        confirmationObserver = null;
                        yesButton.click();
                    }
                }
            }
        });
    });

    // Start observing for the confirmation dialog
    confirmationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style']
    });

    // Safety cleanup - disconnect observer after 3 seconds if no confirmation found
    setTimeout(() => {
        if (confirmationObserver) {
            confirmationObserver.disconnect();
            confirmationObserver = null;
        }
    }, 3000);
}

function checkAndInitialize() {
    // Check if we're on the correct faction page and armoury tab
    if (window.location.href.includes("factions.php") &&
        (window.location.href.includes("tab=armoury") || window.location.hash.includes("tab=armoury"))) {

        const cashSection = document.querySelector('.cash.left');

        if (cashSection) {
            const dollarButton = cashSection.querySelector('.input-money-symbol');
            const inputFields = cashSection.querySelectorAll('.amount.input-money');

            if (dollarButton && inputFields.length >= 2) {
                initializeAutoDeposit();
            } else {
                setTimeout(checkAndInitialize, 500);
            }
        } else {
            console.log("Faction Bank Auto Deposit: Cash section not found, retrying...");
            setTimeout(checkAndInitialize, 500);
        }
    }
}

// Initialize when the page loads
if (window.location.href.includes("factions.php")) {
    checkAndInitialize();
}

// Handle URL changes (for SPA navigation)
if (window.onurlchange === null) {
    window.addEventListener('urlchange', () => {
        if (window.location.href.includes("factions.php")) {
            setTimeout(checkAndInitialize, 300);
        }
    });
}

// Handle regular page loads
window.addEventListener('load', () => {
    if (window.location.href.includes("factions.php")) {
        checkAndInitialize();
    }
});

// Handle dynamic content loading
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
            // Check if the cash section was added or updated
            const cashSection = document.querySelector('.cash.left');

            if (cashSection) {
                const dollarButton = cashSection.querySelector('.input-money-symbol');

                if (dollarButton && !dollarButton.hasAttribute('data-auto-deposit-listener')) {
                    dollarButton.setAttribute('data-auto-deposit-listener', 'true');
                    addAutoDepositListener();
                }
            }
        }
    });
});

// Start observing
observer.observe(document.body, {
    childList: true,
    subtree: true
});
