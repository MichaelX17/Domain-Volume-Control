// content_script.js - v3 (Robust, collaborative version)

const pageState = {
  multiplier: 1.0,
  muted: false,
  audioContext: null,
  elements: new WeakMap() // el -> { gainNode, source, isProgrammaticallyChangingVolume }
};

function getAudioContext() {
  if (!pageState.audioContext || pageState.audioContext.state === 'closed') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      pageState.audioContext = new AudioCtx();
    } catch (e) {
      console.warn('[Tab Volume] Could not create AudioContext. Volume boost will not work.');
      return null;
    }
  }
  return pageState.audioContext;
}

function setupAudioProcessing(el) {
  const ac = getAudioContext();
  if (!ac) return;

  let info = pageState.elements.get(el);
  if (info && info.source) {
    return; // Already set up
  }

  // If we're setting up for the first time, preserve playback state
  const wasPlaying = !el.paused;

  try {
    const source = ac.createMediaElementSource(el);
    const gainNode = ac.createGain();
    source.connect(gainNode);
    gainNode.connect(ac.destination);
    
    info = { gainNode, source, isProgrammaticallyChangingVolume: false };
    pageState.elements.set(el, info);

    // Listen to the native player's volume changes
    el.addEventListener('volumechange', () => {
      if (!pageState.elements.get(el)?.isProgrammaticallyChangingVolume) {
        // User changed volume on the player itself, so we just re-apply our multiplier on top.
        applyMultiplierToElement(el);
      }
    });

  } catch (e) {
    console.error('[Tab Volume] Error setting up audio processing:', e);
    // This can happen if the element's source is from a different origin (CORS)
    // or if the element is already processed.
    return;
  }
    
  // If creating the source paused the video, resume it.
  if (wasPlaying && el.paused) {
    el.play().catch(e => console.warn('[Tab Volume] Could not resume playback:', e));
  }
}

function applyMultiplierToElement(el) {
  if (!el) return;
  setupAudioProcessing(el);

  const info = pageState.elements.get(el);
  if (!info || !info.gainNode) {
    // If setup failed (e.g. CORS), we can't do anything.
    return;
  }

  // The final gain is the user's multiplier * the native player's volume.
  const nativeVolume = el.volume;
  let effectiveGain = pageState.muted ? 0 : pageState.multiplier * nativeVolume;

  // YouTube's audio processing seems to significantly lower the raw signal power.
  // This is a workaround to boost it back up to a reasonable level.
  if (window.location.hostname.includes('youtube.com')) {
    effectiveGain *= 4.0;
  }

  // Set the gain on the gain node
  info.gainNode.gain.setValueAtTime(effectiveGain, pageState.audioContext.currentTime);
}

function applyToAllMediaElements() {
  document.querySelectorAll('video, audio').forEach(el => {
    applyMultiplierToElement(el);
  });
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'applyMultiplier') {
    pageState.multiplier = request.multiplier;
    pageState.muted = request.muted;
    applyToAllMediaElements();
    sendResponse({ success: true });
  } else if (request.action === 'getPageState') {
    // This state is now tab-global, not tied to a specific element's state
    sendResponse({
      volume: pageState.multiplier,
      muted: pageState.muted
    });
  }
  return true;
});

// --- Observers to detect new/changed media elements ---
const mediaObserver = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    // New nodes added
    mutation.addedNodes.forEach(node => {
      if (node.nodeType === 1) {
        if (node.matches('video, audio')) {
          applyMultiplierToElement(node);
        } else if (node.querySelector('video, audio')) {
          node.querySelectorAll('video, audio').forEach(applyMultiplierToElement);
        }
      }
    });
    // If an element's src changes
    if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
        if (mutation.target.matches('video, audio')) {
            applyMultiplierToElement(mutation.target);
        }
    }
  }
});

mediaObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['src']
});

// Apply to any media elements that might already be on the page
applyToAllMediaElements();