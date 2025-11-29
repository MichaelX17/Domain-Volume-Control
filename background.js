// background.js - Simplified for per-tab volume control

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    // A. The popup wants to know the current state for the active tab
    if (request.action === 'getTabState') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          // Ask the content script in that tab for its current state
          const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPageState' });
          sendResponse(response);
        } else {
          sendResponse({ volume: 1.0, muted: false }); // Default state
        }
      } catch (e) {
        // Content script might not be injected yet or tab is protected
        sendResponse({ volume: 1.0, muted: false }); // Default state
      }
      return;
    }

    // B. The popup wants to set the volume for the active tab
    if (request.action === 'setTabVolume') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          // Forward the instruction to the content script of the active tab
          await chrome.tabs.sendMessage(tab.id, {
            action: 'applyMultiplier',
            multiplier: request.multiplier,
            muted: request.muted
          });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No active tab found' });
        }
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return;
    }
  })();

  return true; // Indicates that the response is sent asynchronously
});