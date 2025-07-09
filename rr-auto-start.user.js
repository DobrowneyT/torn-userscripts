// ==UserScript==
// @name         RR Auto Start
// @namespace    MonChoon_
// @version      1.1
// @description  Auto-clicks $ button, Start button, and Yes confirmation for Russian Roulette. Compliant with Torn scripting rules.
// @license      MIT
// @license      MIT
// @author       MonChoon [2250591]
// @match        https://www.torn.com/page.php?sid=russianRoulette*
// @grant        window.onurlchange
// @downloadURL https://github.com/MonChoon/torn-userscripts/raw/main/rr-auto-start.user.js
// @updateURL https://github.com/MonChoon/torn-userscripts/raw/main/rr-auto-start.user.js
// ==/UserScript==

let autoStartEnabled = false;

function initializeAutoStart() {
    // Wait for the page to load completely
    setTimeout(() => {
        addAutoStartListener();
    }, 1000);
}

function addAutoStartListener() {
    // Find the $ button
    const dollarButton = document.querySelector('#moneyInput');
    
    if (dollarButton) {
        // Remove any existing listeners to avoid duplicates
        dollarButton.removeEventListener('click', autoStartHandler);
        
        // Add the auto-start listener
        dollarButton.addEventListener('click', autoStartHandler);
    } else {
        console.log("ERROR: $ button not found! Retrying in 2 seconds...");
        setTimeout(addAutoStartListener, 2000);
    }
}

function autoStartHandler(event) {
    // Get the input field
    const inputField = document.querySelector('.input-money');
    
    if (!inputField) {
        console.log("ERROR: Input field not found!");
        return;
    }
    
    // Read current value before the $ button action
    const initialValue = parseInt(inputField.value) || 0;
    
    // Step 1: Wait for value to change, then click Start
    waitForValueChangeAndStart(inputField, initialValue);
}

function waitForValueChangeAndStart(inputField, initialValue) {
    let attempts = 0;
    const maxAttempts = 20; // Check for up to 1 second
    
    const valueMonitor = setInterval(() => {
        attempts++;
        const currentValue = parseInt(inputField.value) || 0;
        
        if (currentValue !== initialValue && currentValue > 0) {
            clearInterval(valueMonitor);
            clickStartButton();
        } else if (attempts >= maxAttempts) {
            console.log("ERROR: Timeout - Value never changed after clicking $ button");
            clearInterval(valueMonitor);
        }
    }, 50); // Check every 50ms
}

function clickStartButton() {
    // Find the Start button - using multiple selectors for reliability
    let startButton = document.querySelector('button.submit___Yr2z1.torn-btn');
    
    if (!startButton) {
        // Fallback selector
        startButton = document.querySelector('button.torn-btn');
        if (startButton && startButton.textContent.toLowerCase().includes('start')) {
            // Found using fallback selector
        } else {
            startButton = null;
        }
    }
    
    if (startButton) {
        startButton.click();
        
        // Step 2: Wait for confirmation dialog and click Yes
        waitForConfirmationAndClickYes();
    } else {
        console.log("ERROR: Start button not found!");
        console.log("Available buttons:", document.querySelectorAll('button'));
    }
}

function waitForConfirmationAndClickYes() {
    let attempts = 0;
    const maxAttempts = 20; // Check for up to 1 second
    
    const confirmationMonitor = setInterval(() => {
        attempts++;
        
        // Look for the Yes button (confirm button)
        const yesButton = document.querySelector('button[data-type="confirm"]');
        
        if (yesButton) {
            clearInterval(confirmationMonitor);
            yesButton.click();
        } else if (attempts >= maxAttempts) {
            console.log("ERROR: Timeout - Confirmation dialog never appeared");
            clearInterval(confirmationMonitor);
        }
    }, 50); // Check every 50ms
}

// Initialize when the page loads
if (window.location.href.includes("page.php?sid=russianRoulette")) {
    initializeAutoStart();
}

// Handle URL changes (if using SPA navigation)
if (window.onurlchange === null) {
    window.addEventListener('urlchange', () => {
        if (window.location.href.includes("page.php?sid=russianRoulette")) {
            setTimeout(initializeAutoStart, 500);
        }
    });
}

// Also handle regular page loads
window.addEventListener('load', () => {
    if (window.location.href.includes("page.php?sid=russianRoulette")) {
        initializeAutoStart();
    }
});

// Handle dynamic content loading
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
            // Check if the money input was added
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
