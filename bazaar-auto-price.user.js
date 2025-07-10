// ==UserScript==
// @name         Bazaar Auto Price
// @namespace    tos-MonChoon_
// @version      0.8.1
// @description  Auto set bazaar prices on money input field click using API v2. Modified by MonChoon to use item market API.
// @license      MIT
// @author       tos, Lugburz, MonChoon [2250591]
// @match        *.torn.com/bazaar.php*
// @downloadURL  https://github.com/DobrowneyT/torn-userscripts/raw/main/bazaar-auto-price.user.js
// @updateURL    https://github.com/DobrowneyT/torn-userscripts/raw/main/bazaar-auto-price.user.js
// @connect      api.torn.com
// @grant        GM_xmlhttpRequest
// ==/UserScript==

/*
 * Original script by tos, Lugburz
 * Modified by MonChoon [2250591] for compliance with Torn's API ToS Guidelines
 *
 * =============================================================================
 * 🔑 API KEY CONFIGURATION - EDIT THE LINE BELOW WITH YOUR API KEY
 * =============================================================================
 *
 * Replace YOUR_LIMITED-ACCESS_API_KEY with your actual 16-character API key from:
 * https://www.torn.com/preferences.php#tab=api
 *
 * Required Access Level: Limited Access
 *
 * =============================================================================
 * 📋 API TERMS OF SERVICE (ToS) - REQUIRED BY TORN
 * =============================================================================
 *
 * By using this script with your API key, you acknowledge:
 *
 * ┌─────────────────────┬─────────────────────────────────────────────────────┐
 * │ Data Storage        │ Only locally (in this script file)                 │
 * ├─────────────────────┼─────────────────────────────────────────────────────┤
 * │ Data Sharing        │ Nobody                                              │
 * ├─────────────────────┼─────────────────────────────────────────────────────┤
 * │ Purpose of Use      │ Personal automation (bazaar pricing)               │
 * ├─────────────────────┼─────────────────────────────────────────────────────┤
 * │ Key Storage &       │ Not stored / Not shared (only in this script file) │
 * │ Sharing             │                                                     │
 * ├─────────────────────┼─────────────────────────────────────────────────────┤
 * │ Key Access Level    │ Limited Access (or higher)                          │
 * └─────────────────────┴─────────────────────────────────────────────────────┘
 *
 * This script:
 * - Does NOT store your API key anywhere except in this script file
 * - Does NOT share your API key with anyone
 * - Does NOT send your data to any external services
 * - Only uses your API key to fetch market prices from Torn's official API
 * - Complies with all Torn scripting rules and API usage policies
 *
 * You can monitor your API key usage at:
 * https://www.torn.com/preferences.php#tab=api (Key -> Log)
 *
 * =============================================================================
 */

const apikey = 'YOUR_LIMITED-ACCESS_API_KEY'; // ← EDIT THIS LINE WITH YOUR API KEY

// =============================================================================
// DO NOT EDIT BELOW THIS LINE UNLESS YOU KNOW WHAT YOU'RE DOING
// =============================================================================

// Validate API key format
if (apikey === 'YOUR_LIMITED-ACCESS_API_KEY' || !apikey || apikey.length !== 16) {
    alert('⚠️ Bazaar Auto Price Error:\n\nPlease edit the script and replace YOUR_LIMITED-ACCESS_API_KEY with your actual API key.\n\nGet your API key from:\nhttps://www.torn.com/preferences.php#tab=api\n\nRequired Access Level: Limited Access\n(Higher access levels like Full Access will also work)');
    throw new Error('Invalid API key configuration');
}

const torn_api_v2 = async (itemID) => {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://api.torn.com/v2/market/${itemID}/itemmarket?offset=0&key=${apikey}`,
            headers: {
                "Content-Type": "application/json"
            },
            onload: (response) => {
                try {
                    const resjson = JSON.parse(response.responseText);

                    // Check for API errors
                    if (resjson.error) {
                        if (resjson.error.code === 2) {
                            alert('❌ Invalid API Key\n\nPlease check your API key in the script and ensure it:\n- Is 16 characters long\n- Has Limited Access permissions\n- Is copied correctly from your Torn preferences');
                        } else if (resjson.error.code === 5) {
                            console.error('⚠️ API Rate Limit: Too many requests. Please wait before trying again.');
                        }
                        reject(new Error(resjson.error.error || 'API Error'));
                        return;
                    }

                    resolve(resjson);
                } catch(err) {
                    reject(err);
                }
            },
            onerror: (err) => {
                reject(err);
            }
        });
    });
}

var event = new Event('keyup');
var APIERROR = false;

async function lmp(itemID) {
    if(APIERROR === true) return 'API key error';

    try {
        const response = await torn_api_v2(itemID);

        if (response.error) {
            APIERROR = true;
            return 'API key error';
        }

        // Check if we have itemmarket data with listings
        if (response.itemmarket && response.itemmarket.listings && response.itemmarket.listings.length > 0) {
            // Get the lowest price (first item in the sorted listings array)
            const lowest_market_price = response.itemmarket.listings[0].price;
            return lowest_market_price - 5;
        } else {
            return 'No market data available';
        }
    } catch (error) {
        console.error('Bazaar Auto Price API Error:', error);
        APIERROR = true;
        return 'API error';
    }
}

// HACK to simulate input value change
// https://github.com/facebook/react/issues/11488#issuecomment-347775628
function reactInputHack(inputjq, value) {
    // get js object from jquery
    const input = $(inputjq).get(0);

    let lastValue = 0;
    input.value = value;
    let event = new Event('input', { bubbles: true });
    // hack React15
    event.simulated = true;
    // hack React16 内部定义了descriptor拦截value，此处重置状态
    let tracker = input._valueTracker;
    if (tracker) {
        tracker.setValue(lastValue);
    }
    input.dispatchEvent(event);
}

function addOneFocusHandler(elem, itemID) {
    $(elem).on('focus', function(e) {
        this.value = '';
        if (this.value === '') {
            lmp(itemID).then((price) => {
                //this.value = price;
                reactInputHack(this, price);
                this.dispatchEvent(event);
                if(price && typeof price === 'number') $(elem).off('focus');
            });
        }
    });
}

const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
            if (typeof node.classList !== 'undefined' && node.classList) {
                const remove = $(node).find('[class*=removeAmountInput]');
                let input = $(node).find('[class^=input-money]');
                if ($(input).size() > 0 && $(remove).size() > 0) {
                    // Manage items
                    $(input).each(function() {
                        const img = $(this).parent().parent().find('img');
                        const src = $(img).attr('src');
                        if (src) {
                            const itemID = src.split('items/')[1].split('/medium')[0];
                            const inp = $(this).find('.input-money[type=text]');
                            addOneFocusHandler($(inp), itemID);
                        }
                    });
                } else if ($(input).size() > 0) {
                    // Add items
                    input = node.querySelector('.input-money[type=text]');
                    const img = node.querySelector('img');
                    if (input && img) {
                        const itemID = img.src.split('items/')[1].split('/medium')[0].split('/large.png')[0];
                        addOneFocusHandler($(input), itemID);

                        // input amount
                        const input_amount = $(node).find('div.amount').find('.clear-all[type=text]');
                        const inv_amount = $(node).find('div.name-wrap').find('span.t-hide').text();
                        const amount = inv_amount == '' ? 1 : inv_amount.replace('x', '').trim();
                        $(input_amount).on('focus', function() {
                            reactInputHack(input_amount, amount);
                        });
                    }
                }
            }
        }
    }
});

const wrapper = document.querySelector('#bazaarRoot');
if (wrapper) {
    observer.observe(wrapper, { subtree: true, childList: true });
}
