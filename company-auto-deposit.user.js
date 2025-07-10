// ==UserScript==
// @name         Company Auto Deposit
// @namespace    MonChoon_
// @version      1.0
// @description  Auto-submits company deposit after clicking the $ button.
// @license      MIT
// @author       MonChoon [2250591]
// @match        https://www.torn.com/companies.php*
// @grant        window.onurlchange
// @downloadURL https://github.com/DobrowneyT/torn-userscripts/raw/main/company-auto-deposit.user.js
// @updateURL https://github.com/DobrowneyT/torn-userscripts/raw/main/company-auto-deposit.user.js
// ==/UserScript==

function initializeAutoDeposit() {
    // Wait for the page to load completely
    setTimeout(() => {
        addAutoDepositListener();
    }, 500);
}

function addAutoDepositListener() {
    // Target the $ button specifically in the deposit section
    const depositSection = document.querySelector('.funds-wrap.deposit');
    if (!depositSection) {
        console.log("Company Auto Deposit: Deposit section not found, retrying...");
        setTimeout(addAutoDepositListener, 1000);
        return;
    }

    const maxButton = depositSection.querySelector('.input-money-symbol');

    if (maxButton) {
        // Remove any existing listeners to avoid duplicates
        maxButton.removeEventListener('click', autoDepositHandler);

        // Add the auto-deposit listener
        maxButton.addEventListener('click', autoDepositHandler);
    } else {
        console.log("Company Auto Deposit: $ button not found in deposit section, retrying...");
        // Retry after a short delay
        setTimeout(addAutoDepositListener, 1000);
    }
}

// Track if listeners are currently active to prevent spam-clicking issues
let inputListenersActive = false;

function autoDepositHandler(event) {
    console.log("Company Auto Deposit: $ button clicked");

    // Prevent multiple simultaneous listener attachments
    if (inputListenersActive) {
        return;
    }

    // Get the deposit section first
    const depositSection = document.querySelector('.funds-wrap.deposit');
    if (!depositSection) {
        console.log("Company Auto Deposit ERROR: Deposit section not found!");
        return;
    }

    // Get the input elements specifically from the deposit section
    const inputElements = depositSection.querySelectorAll('.input-money');
    const inputVisible = inputElements[0]; // type="text"
    const inputHidden = inputElements[1]; // type="hidden" with name="deposit"

    if (!inputVisible || !inputHidden) {
        console.log("Company Auto Deposit ERROR: Could not find input elements!");
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
            // Find the DEPOSIT button specifically in the deposit section
            const depositButton = depositSection.querySelector('button.torn-btn');
            if (depositButton && !depositButton.disabled) {
                depositButton.click();
                return true;
            } else {
                console.log("Company Auto Deposit: DEPOSIT button not found or disabled!");
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
    // Check if we're on the correct company page and funds section
    if (window.location.href.includes("companies.php") &&
        (window.location.href.includes("option=funds") || window.location.hash.includes("option=funds"))) {

        // Check if the required elements exist
        const depositSection = document.querySelector('.funds-wrap.deposit');

        if (depositSection) {
            const inputElements = depositSection.querySelectorAll('.input-money');
            const maxButton = depositSection.querySelector('.input-money-symbol');

            if (inputElements.length >= 2 && maxButton) {
                initializeAutoDeposit();
            } else {
                // Retry after a short delay
                setTimeout(checkAndInitialize, 500);
            }
        } else {
            console.log("Company Auto Deposit: Deposit section not found, retrying...");
            setTimeout(checkAndInitialize, 500);
        }
    }
}

// Initialize when the page loads
if (window.location.href.includes("companies.php")) {
    checkAndInitialize();
}

// Handle URL changes (for SPA navigation)
if (window.onurlchange === null) {
    window.addEventListener('urlchange', () => {
        if (window.location.href.includes("companies.php")) {
            setTimeout(checkAndInitialize, 300);
        }
    });
}

// Also handle regular page loads
window.addEventListener('load', () => {
    if (window.location.href.includes("companies.php")) {
        checkAndInitialize();
    }
});

// Handle dynamic content loading
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
            // Check if the deposit section was added or updated
            const depositSection = document.querySelector('.funds-wrap.deposit');

            if (depositSection) {
                const maxButton = depositSection.querySelector('.input-money-symbol');
                const inputElements = depositSection.querySelectorAll('.input-money');

                if (maxButton && inputElements.length >= 2 &&
                    !maxButton.hasAttribute('data-auto-deposit-listener')) {
                    maxButton.setAttribute('data-auto-deposit-listener', 'true');
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
