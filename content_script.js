// content_script.js - enhanced version for SPAs and sites that recreate <video> (Facebook, etc.)
// - multiplies native volume by a stored "multiplier" per domain
// - detects dynamically created videos and applies config automatically
// - detects SPA navigation (URL changes) and re-synchronizes
// - avoids loops with programmaticCounter and respects user interaction (ev.isTrusted)
// - includes reapply short-window (retry loop) for cases where the site replaces <video> right after

const DOMAIN = (location.hostname || '').replace(/^www\./i, '').toLowerCase();

const pageState = {
  multiplier: 1.0,
  muted: false,
  nativeVolumeStored: undefined,
  sharedAudioContext: null,
  elements: new WeakMap(), // el -> { gainNode, source, programmaticCounter, nativeVolume, watched }
  lastHref: location.href,
  reapplyTimer: null,
  reapplyIntervalId: null
};

/* -------------------------
   Utilities
   ------------------------- */
function getSharedAudioContext() {
  if (pageState.sharedAudioContext && pageState.sharedAudioContext.state !== 'closed') return pageState.sharedAudioContext;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ac = new AudioCtx();
    pageState.sharedAudioContext = ac;
    return ac;
  } catch (e) {
    // No AudioContext available (policy, browser); everything will continue working without amplification
    // (not critical)
    // console.warn('[VolumeMaster] No AudioContext available', e);
    return null;
  }
}

function safeSetElementVolume(el, v) {
  try {
    el.volume = Math.max(0, Math.min(1, v));
  } catch (e) {
    // some elements may throw; ignore
  }
}

function nowMs() { return Date.now(); }

/* -------------------------
   Element metadata & watchers
   ------------------------- */
function ensureElementInfo(el) {
  let info = pageState.elements.get(el);
  if (!info) {
    info = { gainNode: null, source: null, programmaticCounter: 0, nativeVolume: (typeof el.volume === 'number' ? el.volume : 1.0), watched: false };
    pageState.elements.set(el, info);
  }
  return info;
}

function watchElement(el) {
  const info = ensureElementInfo(el);
  if (info.watched) return;
  info.watched = true;

  // volumechange: detects native user changes
  el.addEventListener('volumechange', (ev) => {
    if (info.programmaticCounter > 0) return;

    const newNative = (typeof el.volume === 'number') ? el.volume : 1.0;
    info.nativeVolume = newNative;

    if (ev.isTrusted) {
      // persist nativeVolume per domain (background saves it)
      try {
        chrome.runtime.sendMessage({ action: 'updateNativeVolume', domain: DOMAIN, nativeVolume: newNative }, () => {});
      } catch (e) {}
    }
  }, { passive: true });

  // When playing, apply config immediately
  const applyNow = () => {
    applyMultiplierToElement(el, pageState.multiplier, pageState.nativeVolumeStored);
    startShortReapplyWindow(); // retry short window after play
  };
  el.addEventListener('play', applyNow, true);
  el.addEventListener('playing', applyNow, true);
  el.addEventListener('canplay', applyNow, true);

  // If src/data-src attribute changes, reapply
  const attrObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && (m.attributeName === 'src' || m.attributeName === 'data-src')) {
        applyNow();
      }
    }
  });
  attrObserver.observe(el, { attributes: true });
}

/* -------------------------
   Reapply short-window mechanism
   -------------------------
   Facebook often destroys and recreates video nodes a few milliseconds after events.
   We'll run a short aggressive reapply loop (every 200ms) for a small window (3s) when
   we detect relevant changes (play, added nodes, URL change). This avoids missing the
   freshly inserted video without keeping a permanent loop.
*/
function startShortReapplyWindow(durationMs = 3000, intervalMs = 200) {
  // clear existing
  if (pageState.reapplyIntervalId) {
    clearInterval(pageState.reapplyIntervalId);
    pageState.reapplyIntervalId = null;
  }
  const end = nowMs() + durationMs;
  pageState.reapplyIntervalId = setInterval(() => {
    applyMultiplierToAll(pageState.multiplier, pageState.nativeVolumeStored);
    if (nowMs() >= end) {
      clearInterval(pageState.reapplyIntervalId);
      pageState.reapplyIntervalId = null;
    }
  }, intervalMs);
}

/* -------------------------
   Multiplier per element
   ------------------------- */
function applyMultiplierToElement(el, multiplier, nativeHint) {
  if (!el) return;
  const info = ensureElementInfo(el);

  if (typeof nativeHint === 'number') info.nativeVolume = nativeHint;

  const nativeVol = (typeof info.nativeVolume === 'number') ? info.nativeVolume : (typeof el.volume === 'number' ? el.volume : 1.0);

  // Silent
  if (multiplier === 0) {
    info.programmaticCounter++;
    safeSetElementVolume(el, 0);
    if (info.gainNode) {
      try { info.gainNode.gain.value = 0; } catch (e) {}
    }
    setTimeout(() => { if (info.programmaticCounter>0) info.programmaticCounter--; }, 80);
    return;
  }

  // multiplier <= 1: prefer property unless gainNode exists
  if (multiplier <= 1.0) {
    if (info.gainNode) {
      info.programmaticCounter++;
      safeSetElementVolume(el, nativeVol);
      try { info.gainNode.gain.value = multiplier; info.gainNode.__lastApplied = multiplier; } catch (e) {}
      setTimeout(() => { if (info.programmaticCounter>0) info.programmaticCounter--; }, 80);
    } else {
      info.programmaticCounter++;
      safeSetElementVolume(el, nativeVol * multiplier);
      setTimeout(() => { if (info.programmaticCounter>0) info.programmaticCounter--; }, 80);
    }
    return;
  }

  // multiplier > 1: amplification via AudioContext
  try {
    const ac = getSharedAudioContext();
    if (!ac) {
      info.programmaticCounter++;
      safeSetElementVolume(el, nativeVol);
      setTimeout(() => { if (info.programmaticCounter>0) info.programmaticCounter--; }, 80);
      return;
    }

    if (!info.source || !info.gainNode) {
      try {
        const src = ac.createMediaElementSource(el);
        info.source = src;
        const gain = ac.createGain();
        gain.gain.value = multiplier;
        src.connect(gain);
        gain.connect(ac.destination);
        info.gainNode = gain;
        info.gainNode.__lastApplied = multiplier;
      } catch (err) {
        // createMediaElementSource sometimes fails; fallback to property
        info.programmaticCounter++;
        safeSetElementVolume(el, nativeVol);
        setTimeout(() => { if (info.programmaticCounter>0) info.programmaticCounter--; }, 80);
        return;
      }
    } else {
      try { info.gainNode.gain.value = multiplier; info.gainNode.__lastApplied = multiplier; } catch (e) {}
    }

    info.programmaticCounter++;
    safeSetElementVolume(el, nativeVol);
    setTimeout(() => { if (info.programmaticCounter>0) info.programmaticCounter--; }, 80);
  } catch (err) {
    info.programmaticCounter++;
    safeSetElementVolume(el, nativeVol);
    setTimeout(() => { if (info.programmaticCounter>0) info.programmaticCounter--; }, 80);
  }
}

/* -------------------------
   Apply to all present media
   ------------------------- */
function applyMultiplierToAll(multiplier, nativeHint) {
  const medias = Array.from(document.querySelectorAll('video, audio'));
  medias.forEach(el => {
    try {
      watchElement(el);
      applyMultiplierToElement(el, multiplier, nativeHint);
    } catch (e) {
      // ignore single element errors
    }
  });
}

/* -------------------------
   Incoming messages
   ------------------------- */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;
  switch (msg.action) {
    case 'applyMultiplier':
    case 'applyMultiplierAndNative': {
      if (typeof msg.multiplier === 'number') pageState.multiplier = msg.multiplier;
      if (typeof msg.muted !== 'undefined') pageState.muted = !!msg.muted;
      const nativeHint = (msg.action === 'applyMultiplierAndNative' && typeof msg.nativeVolume === 'number') ? msg.nativeVolume : undefined;
      applyMultiplierToAll(pageState.multiplier, nativeHint);
      // short reapply window to catch re-created elements
      startShortReapplyWindow();
      sendResponse({ success: true });
      break;
    }
    default:
      break;
  }
});

/* -------------------------
   Request config & initial apply
   ------------------------- */
function requestAndApplyConfig() {
  try {
    chrome.runtime.sendMessage({ action: 'getDomainConfig', domain: DOMAIN }, (resp) => {
      if (!resp) {
        applyMultiplierToAll(1.0);
        return;
      }
      const multiplier = (typeof resp.volume === 'number') ? resp.volume : 1.0;
      pageState.multiplier = multiplier;
      if (typeof resp.muted !== 'undefined') pageState.muted = !!resp.muted;
      if (typeof resp.nativeVolume === 'number') pageState.nativeVolumeStored = resp.nativeVolume;
      applyMultiplierToAll(pageState.multiplier, pageState.nativeVolumeStored);
      startShortReapplyWindow(); // ensure we catch dynamically created videos immediately after load
    });
  } catch (e) {
    applyMultiplierToAll(1.0);
  }
}
requestAndApplyConfig();

/* -------------------------
   MutationObserver - detect new media nodes in DOM
   ------------------------- */
const mo = new MutationObserver((mutations) => {
  let added = false;
  for (const m of mutations) {
    // nodes added -> check for video/audio
    if (m.addedNodes && m.addedNodes.length) {
      m.addedNodes.forEach(node => {
        try {
          if (node.nodeType !== 1) return;
          if (node.matches && (node.matches('video') || node.matches('audio'))) {
            watchElement(node);
            applyMultiplierToElement(node, pageState.multiplier, pageState.nativeVolumeStored);
            added = true;
          } else if (node.querySelectorAll) {
            const medias = node.querySelectorAll('video, audio');
            medias.forEach(el => {
              watchElement(el);
              applyMultiplierToElement(el, pageState.multiplier, pageState.nativeVolumeStored);
              added = true;
            });
          }
        } catch (e) {}
      });
    }
    // attribute changes on elements
    if (m.type === 'attributes' && m.target) {
      try {
        const t = m.target;
        if (t.matches && (t.matches('video') || t.matches('audio'))) {
          watchElement(t);
          applyMultiplierToElement(t, pageState.multiplier, pageState.nativeVolumeStored);
          added = true;
        }
      } catch(e){}
    }
  }
  if (added) startShortReapplyWindow();
});

// Observe wide but not too expensive; attributeFilter focuses on src changes
mo.observe(document.documentElement || document.body || document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src'] });

/* -------------------------
   SPA navigation detection (URL changes)
   ------------------------- */
function checkUrlChange() {
  const href = location.href;
  if (href !== pageState.lastHref) {
    pageState.lastHref = href;
    requestAndApplyConfig();
  }
}
setInterval(checkUrlChange, 700);

/* -------------------------
   Re-apply on key events that indicate media change
   ------------------------- */
window.addEventListener('load', () => { requestAndApplyConfig(); });
document.addEventListener('play', (ev) => {
  const el = ev.target;
  if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
    watchElement(el);
    applyMultiplierToElement(el, pageState.multiplier, pageState.nativeVolumeStored);
  } else {
    applyMultiplierToAll(pageState.multiplier, pageState.nativeVolumeStored);
  }
  startShortReapplyWindow();
}, true);
document.addEventListener('loadeddata', () => { applyMultiplierToAll(pageState.multiplier, pageState.nativeVolumeStored); }, true);

// Also respond to visibility changes (e.g. when Facebook swaps views)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestAndApplyConfig();
    applyMultiplierToAll(pageState.multiplier, pageState.nativeVolumeStored);
    startShortReapplyWindow();
  }
});