// background.js - v3 with programmatic injection

// A Map to keep track of which tabs we've already injected our script into.
const injectedTabs = new Map();

/**
 * Injects the content script into the specified tab if it hasn't been injected yet.
 * @param {number} tabId - The ID of the tab to inject the script into.
 * @returns {Promise<boolean>} - Resolves to true if the script is ready, false otherwise.
 */
async function ensureScripting(tabId) {
  if (injectedTabs.has(tabId)) {
    return true; // Already injected
  }

  try {
    // Check if the tab is a chrome-related page, which we can't script
    const tab = await chrome.tabs.get(tabId);
    if (tab.url?.startsWith('chrome://')) {
      return false;
    }

    // Execute the script
    await chrome.scripting.executeScript({
      target: { tabId: tabId, allFrames: true },
      files: ['content_script.js'],
    });
    
    injectedTabs.set(tabId, true);
    return true;
  } catch (e) {
    console.error(`[Tab Volume] Failed to inject script into tab ${tabId}:`, e);
    return false;
  }
}

// Clean up the injectedTabs map when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (injectedTabs.has(tabId)) {
    injectedTabs.delete(tabId);
  }
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      sendResponse({ success: false, error: 'No active tab found' });
      return;
    }

    const canScript = await ensureScripting(tab.id);
    if (!canScript) {
      // For 'getTabState', we must respond, otherwise the popup will hang.
      if (request.action === 'getTabState') {
        sendResponse({ volume: 1.0, muted: false, error: 'Cannot script this page' });
      } else {
        sendResponse({ success: false, error: 'Cannot script this page' });
      }
      return;
    }

    // A. The popup wants to know the current state for the active tab
    if (request.action === 'getTabState') {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageState' });
        sendResponse(response);
      } catch (e) {
        console.warn(`[Tab Volume] Could not get tab state for tab ${tab.id}:`, e);
        sendResponse({ volume: 1.0, muted: false }); // Default state
      }
      return;
    }

    // B. The popup wants to set the volume for the active tab
    if (request.action === 'setTabVolume') {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'applyMultiplier',
          multiplier: request.multiplier,
          muted: request.muted
        });
        sendResponse({ success: true });
      } catch (e) {
        console.error(`[Tab Volume] Failed to set volume for tab ${tab.id}:`, e);
        sendResponse({ success: false, error: e.message });
      }
      return;
    }
  })();

  return true; // Indicates that the response is sent asynchronously
});
