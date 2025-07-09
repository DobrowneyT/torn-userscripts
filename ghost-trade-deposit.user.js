// ==UserScript==
// @name         Ghost Trade Deposit
// @namespace    MonChoon_
// @version      1.1
// @description  Auto-submits trade after clicking the $ button. Compliant with Torn scripting rules.
// @license      MIT
// @author       MonChoon [2250591]
// @match        https://www.torn.com/trade.php*
// @grant        window.onurlchange
// @downloadURL https://github.com/DobrowneyT/torn-userscripts/raw/main/ghost-trade-deposit.user.js
// @updateURL https://github.com/DobrowneyT/torn-userscripts/raw/main/ghost-trade-deposit.user.js
// ==/UserScript==

function initializeAutoDeposit() {
    // Wait for the page to load completely
    setTimeout(() => {
        addAutoDepositListener();
    }, 500);
}

function addAutoDepositListener() {
    // Target the span that users actually click on (contains the $ symbol)
    const maxButton = document.querySelector('.input-money-symbol');

    if (maxButton) {
        // Remove any existing listeners to avoid duplicates
        maxButton.removeEventListener('click', autoDepositHandler);

        // Add the auto-deposit listener
        maxButton.addEventListener('click', autoDepositHandler);
    } else {
        console.log("Ghost Trade Deposit (Event): $ button (.input-money-symbol) not found, retrying...");
        // Retry after a short delay
        setTimeout(addAutoDepositListener, 1000);
    }
}

// Track if listeners are currently active to prevent spam-clicking issues
let inputListenersActive = false;

function autoDepositHandler(event) {

    // Prevent multiple simultaneous listener attachments
    if (inputListenersActive) {
        return;
    }

    // Get the input elements
    const inputVisible = document.querySelector(".user-id.input-money");
    const inputHidden = document.querySelectorAll(".user-id.input-money")[1];


    if (!inputVisible || !inputHidden) {
        console.log("Ghost Trade Deposit (Event) ERROR: Could not find input elements!");
        return;
    }

    // Read current value before the $ button action
    const initialValue = parseInt(inputHidden.value) || 0;

    // Mark listeners as active
    inputListenersActive = true;

    // Function to submit the form
    function submitDeposit() {
        const currentValue = parseInt(inputHidden.value) || 0;

        if (currentValue !== initialValue && currentValue > 0) {
            const changeButton = document.querySelector('input[type="submit"][value="Change"]');
            if (changeButton) {
                changeButton.click();
                return true;
            } else {
                console.log("Ghost Trade Deposit (Event) ERROR: Change button not found!");
                return false;
            }
        } else {
            return false;
        }
    }

    // Function to clean up and reset
    function cleanupAndReset() {
        inputListenersActive = false;
    }

    // Listen for the 'input' event on both input fields (interrupt-style)
    function createInputListener(inputElement, elementName) {
        const listener = function(e) {
            const submitted = submitDeposit();

            // Always clean up and reset after any event fires
            cleanupAndReset();

            // Remove the listener after use
            inputElement.removeEventListener('input', listener);
        };

        inputElement.addEventListener('input', listener);
    }

    // Also listen for 'change' events as a backup
    function createChangeListener(inputElement, elementName) {
        const listener = function(e) {
            const submitted = submitDeposit();

            // Always clean up and reset after any event fires
            cleanupAndReset();

            // Remove the listener after use
            inputElement.removeEventListener('change', listener);
        };

        inputElement.addEventListener('change', listener);
    }

    // Attach listeners to both input elements
    createInputListener(inputVisible, "visible input");
    createInputListener(inputHidden, "hidden input");
    createChangeListener(inputVisible, "visible input");
    createChangeListener(inputHidden, "hidden input");

}

function checkAndInitialize() {
    // Check if we're on the correct trade page section
    if (window.location.href.includes("trade.php") &&
        (window.location.href.includes("step=addmoney") || window.location.href.includes("step=initiateTrade"))) {

        // Check if the required elements exist
        const inputElements = document.querySelectorAll('.user-id.input-money');
        const maxButton = document.querySelector('.input-money-symbol');

        if (inputElements.length >= 2 && maxButton) {
            initializeAutoDeposit();
        } else {
            // Retry after a short delay
            setTimeout(checkAndInitialize, 500);
        }
    }
}

// Initialize when the page loads
if (window.location.href.includes("trade.php")) {
    checkAndInitialize();
}

// Handle URL changes (for SPA navigation)
if (window.onurlchange === null) {
    window.addEventListener('urlchange', () => {
        if (window.location.href.includes("trade.php")) {
            setTimeout(checkAndInitialize, 300);
        }
    });
}

// Also handle regular page loads
window.addEventListener('load', () => {
    if (window.location.href.includes("trade.php")) {
        checkAndInitialize();
    }
});

// Handle dynamic content loading
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
            // Check if the money input or max button was added
            const maxButton = document.querySelector('.input-money-symbol');
            const inputElements = document.querySelectorAll('.user-id.input-money');

            if (maxButton && inputElements.length >= 2 &&
                !maxButton.hasAttribute('data-auto-deposit-listener')) {
                maxButton.setAttribute('data-auto-deposit-listener', 'true');
                addAutoDepositListener();
            }
        }
    });
});

// Start observing
observer.observe(document.body, {
    childList: true,
    subtree: true
});
