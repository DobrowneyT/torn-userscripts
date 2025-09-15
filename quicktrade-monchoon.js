// ==UserScript==
// @name         QuickTrade v2.0 - MonChoon Edition
// @namespace    https://www.torn.com/
// @version      2.0.0
// @description  Calculates total trade value based on up-to-date prices from Google Sheets pricelist
// @author       MonChoon [2250591] - Based on original by Betrayer [1870130]
// @match        https://www.torn.com/trade.php*
// @grant        GM.xmlHttpRequest
// @downloadURL  https://github.com/DobrowneyT/torn-userscripts/raw/main/quicktrade-monchoon.js
// @updateURL    https://github.com/DobrowneyT/torn-userscripts/raw/main/quicktrade-monchoon.js
// ==/UserScript==

(function() {
    'use strict';

    // =============================================================================
    // 🔑 CONFIGURATION - EDIT THESE VALUES
    // =============================================================================

    // Your Google Apps Script Web App URL (get this after deploying your script)
    const APP_URL = 'https://script.google.com/macros/s/AKfycbyomClNFC_jF8AO-dMaTOvctTDda1gpDf0m1RF8j8vkVW1Tk2gJhjKE6KE6ueqDp8w1/exec';

    // Your QT_KEY from the Google Sheet (must match the one in QuickTrade.gs)
    const QT_KEY = 'IHJLi5bsCVbFO0mR';

    // Optional: Enable chat receipt functionality (not implemented yet)
    const CHAT_RECEIPT = false;

    // =============================================================================
    // CONFIGURATION END - DO NOT EDIT BELOW UNLESS YOU KNOW WHAT YOU'RE DOING
    // =============================================================================

    // Validate configuration
    if (APP_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE' || !APP_URL) {
        console.error('QuickTrade: Please configure your Google Apps Script URL in the userscript');
        return;
    }

    let cachedPrices = null;
    let cacheExpiry = null;
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    // Fetch prices from Google Sheet
    function getPrices() {
        return new Promise((resolve, reject) => {
            // Check cache first
            if (cachedPrices && cacheExpiry && Date.now() < cacheExpiry) {
                console.log('QuickTrade: Using cached prices');
                resolve(cachedPrices);
                return;
            }

            console.log('QuickTrade: Fetching fresh prices from Google Sheet...');

            GM.xmlHttpRequest({
                method: 'GET',
                url: APP_URL + '?key=' + QT_KEY,
                onload: (response) => {
                    try {
                        const data = JSON.parse(response.response);

                        if (data.error) {
                            console.error('QuickTrade API Error:', data.error);
                            alert('QuickTrade Error: ' + data.error);
                            reject(new Error(data.error));
                            return;
                        }

                        if (data.hasOwnProperty('prices')) {
                            cachedPrices = data.prices;
                            cacheExpiry = Date.now() + CACHE_DURATION;
                            console.log(`QuickTrade: Loaded ${Object.keys(cachedPrices).length} items`);
                            resolve(cachedPrices);
                        } else {
                            console.error('QuickTrade: Invalid response format');
                            alert('QuickTrade: Invalid response from price sheet');
                            reject(new Error('Invalid response format'));
                        }
                    } catch(e) {
                        console.error('QuickTrade: Parse error:', e);
                        alert('QuickTrade: Failed to parse price data. Check your Google Apps Script URL and key.');
                        reject(e);
                    }
                },
                onerror: error => {
                    console.error('QuickTrade: Request error:', error);
                    alert('QuickTrade: Failed to connect to price sheet. Check your Google Apps Script URL.');
                    reject(error);
                }
            });
        });
    }

    // Copy text to clipboard
    const copyToClipboard = str => {
        const el = document.createElement('textarea');
        el.value = str;
        el.setAttribute('readonly', '');
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
    };

    // Add the value and profit display to the trade
    function addValueAndProfit(totalBuyPrice, totalProfit, tradeInfo) {
        // Remove existing QuickTrade elements
        const existingBanner = document.getElementById('quickTradeBanner');
        if (existingBanner) {
            existingBanner.remove();
        }

        // Create the banner at the top
        const banner = document.createElement('div');
        banner.id = 'quickTradeBanner';
        banner.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px;
            margin: 10px 0;
            border-radius: 8px;
            text-align: center;
            font-family: 'Arial', sans-serif;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            border: 2px solid #4f46e5;
        `;

        banner.innerHTML = `
            <div style="font-size: 24px; font-weight: bold; margin-bottom: 5px;">
                ⚡ QuickTrade ⚡
            </div>
            <div style="font-size: 18px; margin-bottom: 8px;">
                💰 Trade Value - <span id="qtValue" style="cursor: pointer; text-decoration: underline;" title="Click to copy trade value">$${totalBuyPrice.toLocaleString()}</span>
            </div>
            <div style="font-size: 16px;">
                📈 Expected Profit - $${totalProfit.toLocaleString()} (${Math.round(totalProfit/totalBuyPrice*100)}%)
            </div>
        `;

        // Insert banner at the top of the content
        const contentWrapper = document.querySelector('.content-wrapper') || document.querySelector('#trade-container') || document.querySelector('.main-desktop-page');
        if (contentWrapper) {
            contentWrapper.insertBefore(banner, contentWrapper.firstChild);
        }

        // Add click handler for copying trade value
        const valueElement = document.getElementById('qtValue');
        if (valueElement) {
            valueElement.addEventListener('click', () => {
                const oldBg = valueElement.style.backgroundColor;
                valueElement.style.backgroundColor = 'yellow';
                valueElement.style.color = 'black';

                setTimeout(() => {
                    valueElement.style.backgroundColor = oldBg;
                    valueElement.style.color = 'white';
                }, 500);

                copyToClipboard(totalBuyPrice.toString());
                console.log('QuickTrade: Copied trade value to clipboard');
            });
        }
    }

    // Parse item name and quantity from various trade interface formats
    function parseItemInfo(itemText) {
        // Remove any extra whitespace and normalize
        itemText = itemText.trim();

        // Handle different formats:
        // "Item Name x5"
        // "Item Name 5x"
        // "Item Name [5]"
        // "Item Name (5)"

        let quantity = 1;
        let itemName = itemText;

        // Try different patterns
        const patterns = [
            /^(.+?)\s+x(\d+)$/i,           // "Item Name x5"
            /^(.+?)\s+(\d+)x$/i,           // "Item Name 5x"
            /^(.+?)\s*\[(\d+)\]$/i,        // "Item Name [5]"
            /^(.+?)\s*\((\d+)\)$/i,        // "Item Name (5)"
            /^(.+?)\s+(\d+)$/               // "Item Name 5"
        ];

        for (const pattern of patterns) {
            const match = itemText.match(pattern);
            if (match) {
                itemName = match[1].trim();
                quantity = parseInt(match[2]) || 1;
                break;
            }
        }

        return { itemName: itemName.toLowerCase(), quantity };
    }

    // Add tooltips and calculate totals for trade items
    function addItemTitles(prices) {
        const items = [];
        const quantities = [];
        const unitPrices = [];
        const totalUnitPrices = [];

        let totalBuyPrice = 0;
        let totalProfit = 0;
        let itemsProcessed = 0;
        let itemsNotFound = 0;

        // Find trade items in the DOM
        // Try multiple selectors for different trade interface versions
        const selectors = [
            '.user.right .color2 > .desc > li',  // Original selector
            '.trade-item',                        // Alternative selector
            '[class*="item-"]',                   // Items with class containing "item-"
            '.item-container li',                 // Items in container
            '.trade-container .item'              // Trade container items
        ];

        let tradeItems = [];
        for (const selector of selectors) {
            tradeItems = document.querySelectorAll(selector);
            if (tradeItems.length > 0) {
                console.log(`QuickTrade: Found ${tradeItems.length} items using selector: ${selector}`);
                break;
            }
        }

        if (tradeItems.length === 0) {
            console.log('QuickTrade: No trade items found in DOM');
            return;
        }

        tradeItems.forEach((element, index) => {
            // Skip if this is our own injected content
            if (element.innerHTML.includes('Total') || element.innerHTML.includes('Expected') || element.innerHTML.includes('Receipt')) {
                return;
            }

            // Get item text from various possible locations
            let itemText = '';
            const textSelectors = [
                '.name.left',
                '.item-name',
                '.name',
                'span',
                ''  // Use element text directly
            ];

            for (const textSelector of textSelectors) {
                const textElement = textSelector ? element.querySelector(textSelector) : element;
                if (textElement && textElement.textContent.trim()) {
                    itemText = textElement.textContent.trim();
                    break;
                }
            }

            if (!itemText) {
                console.log('QuickTrade: Could not extract item text from element', element);
                return;
            }

            const { itemName, quantity } = parseItemInfo(itemText);
            itemsProcessed++;

            console.log(`QuickTrade: Processing item "${itemName}" x${quantity}`);

            // Look up price in our price list
            const priceData = prices[itemName];

            if (!priceData) {
                console.log(`QuickTrade: Item "${itemName}" not found in price list`);
                itemsNotFound++;

                // Mark item as not found
                element.style.backgroundColor = 'rgba(255, 99, 71, 0.3)';
                element.title = `❌ "${itemName}" not found in price list!`;
                element.style.border = '2px solid #ff6347';
                return;
            }

            if (isNaN(priceData.buy_price) || priceData.buy_price <= 0) {
                console.log(`QuickTrade: Item "${itemName}" has invalid price`);
                itemsNotFound++;

                element.style.backgroundColor = 'rgba(255, 165, 0, 0.3)';
                element.title = `⚠️ "${itemName}" has no valid price set!`;
                element.style.border = '2px solid #ffa500';
                return;
            }

            // Calculate totals
            const itemTotal = priceData.buy_price * quantity;
            const itemProfit = priceData.profit * quantity;

            totalBuyPrice += itemTotal;
            totalProfit += itemProfit;

            // Store for potential future use
            items.push(itemName);
            quantities.push(quantity);
            unitPrices.push(priceData.buy_price);
            totalUnitPrices.push(itemTotal);

            // Add tooltip with pricing info
            element.title = `💰 $${priceData.buy_price.toLocaleString()} x ${quantity} = $${itemTotal.toLocaleString()}\n` +
                          `📊 Market: $${priceData.market_value.toLocaleString()}\n` +
                          `📈 Profit: $${itemProfit.toLocaleString()}\n` +
                          `🏷️ Category: ${priceData.category}`;

            // Style the element to show it's been processed
            element.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
            element.style.border = '2px solid #4caf50';
            element.style.borderRadius = '4px';
            element.style.padding = '2px';
        });

        console.log(`QuickTrade: Processed ${itemsProcessed} items, ${itemsNotFound} not found, Total: $${totalBuyPrice.toLocaleString()}`);

        if (totalBuyPrice > 0) {
            const tradeInfo = { items, quantities, unitPrices, totalUnitPrices };
            addValueAndProfit(totalBuyPrice, totalProfit, tradeInfo);
        }
    }

    // Main function to process the trade
    function processTradeItems() {
        // Only run on trade view pages
        if (!window.location.href.includes('trade.php') || !window.location.href.includes('step=view')) {
            return;
        }

        console.log('QuickTrade: Processing trade items...');

        getPrices().then((prices) => {
            addItemTitles(prices);
        }).catch((error) => {
            console.error('QuickTrade: Failed to get prices:', error);
        });
    }

    // Initialize the script
    function initialize() {
        console.log('QuickTrade v2.0: Initializing...');

        // Process items immediately if we're on a trade page
        if (window.location.href.includes('trade.php')) {
            setTimeout(processTradeItems, 1000); // Give page time to load
        }

        // Watch for DOM changes (for dynamic content loading)
        const observer = new MutationObserver((mutations) => {
            let shouldProcess = false;

            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                    // Check if trade content was added
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (node.querySelector && (
                                node.querySelector('.trade-item') ||
                                node.querySelector('.color2') ||
                                node.classList.contains('trade-container')
                            )) {
                                shouldProcess = true;
                                break;
                            }
                        }
                    }
                }
            });

            if (shouldProcess) {
                console.log('QuickTrade: DOM changed, reprocessing...');
                setTimeout(processTradeItems, 500);
            }
        });

        // Start observing
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Also listen for URL changes (for SPA navigation)
        let currentUrl = window.location.href;
        const urlObserver = new MutationObserver(() => {
            if (window.location.href !== currentUrl) {
                currentUrl = window.location.href;
                if (currentUrl.includes('trade.php')) {
                    console.log('QuickTrade: URL changed to trade page');
                    setTimeout(processTradeItems, 1000);
                }
            }
        });

        urlObserver.observe(document.querySelector('title'), {
            childList: true,
            subtree: true
        });

        console.log('QuickTrade v2.0: Initialized successfully');
    }

    // Start the script when page is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

})();
