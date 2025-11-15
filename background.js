// background.js - domain-based, with separation between MULTIPLIER and NATIVE volume
// Keys in storage: domainConfig_<domain> = { multiplier: number, muted: boolean, nativeVolume?: number }

function extractDomainFromUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch (e) {
    return null;
  }
}

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => resolve(res[key]));
  });
}
function storageSet(obj) {
  return new Promise((resolve) => {
    chrome.storage.local.set(obj, () => resolve());
  });
}
function domainKey(domain) {
  return `domainConfig_${domain}`;
}

// Returns the complete configuration (multiplier, muted, and optional nativeVolume)
async function getDomainConfig(domain) {
  const key = domainKey(domain);
  const stored = await storageGet(key);
  if (!stored) return { multiplier: 1.0, muted: false, nativeVolume: undefined };
  return {
    multiplier: typeof stored.multiplier === 'number' ? stored.multiplier : (typeof stored.volume === 'number' ? stored.volume : 1.0),
    muted: !!stored.muted,
    nativeVolume: typeof stored.nativeVolume === 'number' ? stored.nativeVolume : undefined
  };
}

async function saveDomainConfig(domain, cfg) {
  const key = domainKey(domain);
  const toStore = {
    multiplier: typeof cfg.multiplier === 'number' ? cfg.multiplier : (typeof cfg.volume === 'number' ? cfg.volume : 1.0),
    muted: !!cfg.muted
  };
  if (typeof cfg.nativeVolume === 'number') toStore.nativeVolume = cfg.nativeVolume;
  await storageSet({ [key]: toStore });
}

// Send message to a tab (promised)
function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ ok: true, resp });
      }
    });
  });
}

// Send to all tabs in the domain
async function broadcastToDomain(domain, message) {
  const tabs = await new Promise((res) => chrome.tabs.query({}, res));
  const results = [];
  for (const t of tabs) {
    try {
      const tabDomain = extractDomainFromUrl(t.url || '');
      if (tabDomain === domain) {
        // eslint-disable-next-line no-await-in-loop
        const r = await sendMessageToTab(t.id, message);
        results.push({ tabId: t.id, ...r });
      }
    } catch (e) {
      results.push({ tabId: t.id, ok: false, error: String(e) });
    }
  }
  return results;
}

// Messaging
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      const action = request.action;
      // Determine domain
      let domain = request.domain || null;
      if (!domain && sender && sender.tab && sender.tab.url) {
        domain = extractDomainFromUrl(sender.tab.url);
      }
      if (!domain && request.tabId) {
        try {
          const tab = await new Promise((res) => chrome.tabs.get(request.tabId, res));
          if (tab && tab.url) domain = extractDomainFromUrl(tab.url);
        } catch (e) {}
      }

      // getDomainConfig (used by popup to load UI)
      if (action === 'getDomainConfig') {
        if (!domain) return sendResponse({ multiplier: 1.0, muted: false });
        const cfg = await getDomainConfig(domain);
        // Return the expected form of the popup: { volume: multiplier, muted: bool }
        sendResponse({ volume: cfg.multiplier, muted: cfg.muted, nativeVolume: cfg.nativeVolume });
        return;
      }

      // setDomainConfig: deliberate change of the multiplier (comes from the popup)
      if (action === 'setDomainConfig') {
        if (!domain) {
          sendResponse({ success: false, error: 'no domain' });
          return;
        }
        const multiplier = typeof request.multiplier === 'number' ? request.multiplier : (typeof request.volume === 'number' ? request.volume : 1.0);
        const muted = !!request.muted;
        await saveDomainConfig(domain, { multiplier, muted, nativeVolume: request.nativeVolume });
        // Propagate to all tabs in the domain: we apply multiplier and mute
        await broadcastToDomain(domain, { action: 'applyMultiplier', multiplier, muted });
        sendResponse({ success: true });
        return;
      }

      // updateNativeVolume: the content script reports that the user changed the native slider
      if (action === 'updateNativeVolume') {
        if (!domain) {
          sendResponse({ success: false, error: 'no domain' });
          return;
        }
        const nativeVol = typeof request.nativeVolume === 'number' ? request.nativeVolume : undefined;
        // We save nativeVolume in the config without touching multiplier
        const cfg = await getDomainConfig(domain);
        cfg.nativeVolume = nativeVol;
        await saveDomainConfig(domain, cfg);
        // NOTE: We do not propagate the multiplier here; we only store the native reference
        sendResponse({ success: true });
        return;
      }

      // enforcedDomain: apply immediately (used when opening a tab via popup)
      if (action === 'enforceDomain') {
        if (!domain) {
          sendResponse({ success: false, error: 'no domain' });
          return;
        }
        const cfg = await getDomainConfig(domain);
        // Prefer to send to specific tabId first
        if (request.tabId) {
          await sendMessageToTab(request.tabId, { action: 'applyMultiplier', multiplier: cfg.multiplier, muted: cfg.muted, nativeVolume: cfg.nativeVolume });
        }
        // And broadcast in case there are other open tabs on the domain.
        const br = await broadcastToDomain(domain, { action: 'applyMultiplier', multiplier: cfg.multiplier, muted: cfg.muted, nativeVolume: cfg.nativeVolume });
        sendResponse({ success: true, results: br });
        return;
      }

      sendResponse({ success: false, error: 'unknown action' });
    } catch (err) {
      try { sendResponse({ success: false, error: String(err) }); } catch (e) {}
    }
  })();

  return true;
});


// -----------------------------------------
// APPLY CONFIGURATION AUTOMATICALLY WHEN CHANGING PAGE
// -----------------------------------------

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.status || changeInfo.status !== "complete") return;
  if (!tab.url) return;

  const domain = extractDomain(tab.url);
  if (!domain) return;

  // We ask the content script to apply the domain configuration
  try {
    await chrome.runtime.sendMessage({
      action: "enforceDomain",
      domain,
      tabId
    });
  } catch (e) {
    // Silent, sometimes there's no CS on Facebook yet
  }
});

// Same consistent extractor as in popup.js
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}
