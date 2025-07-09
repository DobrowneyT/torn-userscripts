// ==UserScript==
// @name         Ghost Trade Buttons
// @namespace    Titanic_-MonChoon_
// @version      1.68
// @description  Adds buttons to remove at million $ intervals to the trade page to make it easier to manage money in ghost trades. Auto-submits after clicking max $. Compliant with Torn scripting rules. Modified by MonChoon to add auto-submit functionality.
// @license      MIT
// @license      MIT
// @author       Titanic_ [2968477], MonChoon [2250591] (modifications)
// @match        https://www.torn.com/trade.php*
// @grant        window.onurlchange
// @downloadURL https://github.com/MonChoon/torn-userscripts/raw/main/ghost-trade-buttons.user.js
// @updateURL https://github.com/MonChoon/torn-userscripts/raw/main/ghost-trade-buttons.user.js
// ==/UserScript==

let ran = false;

function addElements() {
    ran = false;

    let div;
    let parent = document.createElement("div");

    addButton(parent, "-10m", 10000000, false);
    addButton(parent, "-50m", 50000000, false);
    addButton(parent, "-100m", 100000000, false);
    addButton(parent, "-500m", 500000000, false);
    addButton(parent, "-1b", 1000000000, false);

    div = document.querySelector("div.input-money-group.success");

    div.parentNode.insertBefore(parent, div.nextSibling);
    
    // Add auto-submit functionality after elements are added
    setTimeout(() => {
        addAutoSubmitListener();
    }, 100);
}

function addButton(parent, label, amount) {
    let btn = document.createElement("input");
    btn.value = label;
    btn.type = "button";
    btn.classList.add("torn-btn");

    btn.addEventListener("click", () => {
        let $inputVisible = document.querySelector(".user-id.input-money");
        let $inputHidden = document.querySelectorAll(".user-id.input-money")[1];
        let value = parseInt($inputHidden.value);

        if (value - amount > 0) {
            value -= amount;
            $inputVisible.value = value;
            $inputVisible.dispatchEvent(new Event("input", { bubbles: true }));
        }
    });

    if (ran == false) {
        parent.prepend(document.querySelector("span.btn-wrap.silver").previousElementSibling.cloneNode());
        ran = true;
    }

    parent.appendChild(btn);
}

function addAutoSubmitListener() {
    // Target the span that users actually click on (contains the $ symbol)
    const maxButton = document.querySelector('.input-money-symbol');
    
    if (maxButton) {
        // Remove any existing listeners to avoid duplicates
        maxButton.removeEventListener('click', autoSubmitHandler);
        
        // Add the auto-submit listener
        maxButton.addEventListener('click', autoSubmitHandler);
    } else {
        console.log("ERROR: $ button (.input-money-symbol) not found!");
    }
}

function autoSubmitHandler(event) {
    // Get the input elements
    const inputVisible = document.querySelector(".user-id.input-money");
    const inputHidden = document.querySelectorAll(".user-id.input-money")[1];
    
    if (!inputVisible || !inputHidden) {
        console.log("ERROR: Could not find input elements!");
        return;
    }
    
    // Read current value before the $ button action
    const initialValue = parseInt(inputHidden.value) || 0;
    
    // Function to check if value has changed and submit if it has
    function checkValueAndSubmit() {
        const currentValue = parseInt(inputHidden.value) || 0;
        
        if (currentValue !== initialValue && currentValue > 0) {
            const changeButton = document.querySelector('input[type="submit"][value="Change"]');
            if (changeButton) {
                changeButton.click();
            } else {
                console.log("ERROR: Change button not found!");
            }
        }
    }
    
    // Monitor for value changes with multiple checks
    let attempts = 0;
    const maxAttempts = 20; // Check for up to 1 second (20 * 50ms)
    
    const valueMonitor = setInterval(() => {
        attempts++;
        checkValueAndSubmit();
        
        const currentValue = parseInt(inputHidden.value) || 0;
        
        // Stop monitoring if value changed or we've tried too many times
        if (currentValue !== initialValue || attempts >= maxAttempts) {
            clearInterval(valueMonitor);
            
            if (attempts >= maxAttempts && currentValue === initialValue) {
                console.log("ERROR: Timeout - Value never changed after clicking $ button");
            }
        }
    }, 50); // Check every 50ms
}

function addPasteButton(parent) {
    let btn = document.createElement("input");
    btn.value = "Paste";
    btn.type = "button";
    btn.classList.add("torn-btn");

    btn.addEventListener("click", () => {
        let $inputVisible = document.querySelector(".user-id.input-money");
        let $inputHidden = document.querySelectorAll(".user-id.input-money")[1];
        navigator.clipboard.readText().then((clipboardValue) => {
            clipboardValue = clipboardValue.replace(/[, $]/g, '');
            if (parseInt(clipboardValue)) {
                $inputVisible.value = parseInt(clipboardValue);
                $inputVisible.dispatchEvent(new Event("input", { bubbles: true }));
            } else {
                alert("Not a number");
            }
        });
    });

    parent.appendChild(btn);
}

function addCustomButton(parent) {
    let btn = document.createElement("input");
    btn.value = "Custom";
    btn.type = "button";
    btn.classList.add("torn-btn");

    btn.addEventListener("click", () => {
        let $inputVisible = document.querySelector(".user-id.input-money");
        let $inputHidden = document.querySelectorAll(".user-id.input-money")[1];
        navigator.clipboard.readText().then((clipboardValue) => {
            clipboardValue = clipboardValue.replace(/[, $]/g, '');
            if (parseInt(clipboardValue)) {
                $inputVisible.value = parseInt($inputHidden.value) - parseInt(clipboardValue);
                $inputVisible.dispatchEvent(new Event("input", { bubbles: true }));
            } else {
                var value = prompt("How much to subtract");
                if (parseInt(value)) {
                    $inputVisible.value = parseInt($inputHidden.value) - parseInt(value);
                    $inputVisible.dispatchEvent(new Event("input", { bubbles: true }));
                }
            }
        });
    });

    parent.appendChild(btn);
}

if (window.location.href.includes("trade.php#step=addmoney")) {
    inputCheck();
}

if (window.onurlchange === null) {
    window.addEventListener('urlchange', () => {
        inputCheck();
    });
}

function inputCheck() {
    setTimeout(function() {
        if ($('.user-id.input-money').length > 0 && $("ul.inputs > li > div").length < 3) {
            addElements();
        } else {
            setTimeout(inputCheck, 500);
        }
    }, 300);
}
