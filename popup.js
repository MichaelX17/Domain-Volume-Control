let currentTab = null;

// Consistent configuration model
let currentConfig = {
  domain: null,     // current domain (without www, lowercase)
  volume: 1.0,      // here volume acts as "multiplier" (1.0 = 100%)
  muted: false
};

let currentNeonColor = '#00ff00';

const volumeSlider = document.getElementById('volumeSlider');
const currentVolume = document.getElementById('currentVolume');
const muteButton = document.getElementById('muteButton');
const resetButton = document.getElementById('resetButton');
const maxButton = document.getElementById('maxButton');
const neonColorPicker = document.getElementById('neonColor');

// -----------------------------
// INITIALIZATION
// -----------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  const domain = extractDomain(tab.url);
  currentConfig.domain = domain;

  await loadNeonColor();
  await loadDomainConfig(domain);
  applyNeonColor(currentNeonColor);

  // Ask background to apply configuration to current tab (if background can do it)
  // use enforceDomain (not enforceVolume — that was the invalid action)
  await ensureDomainEnforced(domain);
});

// -----------------------------
// Load domain configuration
// -----------------------------
async function loadDomainConfig(domain) {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getDomainConfig',
      domain
    });

    // background returns { volume: multiplier, muted: bool, nativeVolume? }
    if (response && typeof response.volume === 'number') {
      currentConfig.volume = response.volume;
      currentConfig.muted = !!response.muted;
    } else {
      currentConfig.volume = 1.0;
      currentConfig.muted = false;
    }
  } catch (e) {
    console.error('Error reading domain:', e);
    currentConfig.volume = 1.0;
    currentConfig.muted = false;
  }

  updateUI();
}

// -----------------------------
// Save domain configuration
// -----------------------------
async function saveDomainConfig() {
  if (!currentConfig.domain) return;

  // Send explicit multiplier (avoids ambiguities)
  await chrome.runtime.sendMessage({
    action: 'setDomainConfig',
    domain: currentConfig.domain,
    multiplier: currentConfig.volume,
    muted: currentConfig.muted
  });
}

// -----------------------------
// Extract domain (consistent)
// -----------------------------
function extractDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./i, '').toLowerCase(); // facebook.com instead of www.facebook.com
  } catch {
    return null;
  }
}

// -----------------------------
// NEON
// -----------------------------
async function loadNeonColor() {
  const res = await chrome.storage.local.get(['neonColor']);
  if (res.neonColor) {
    currentNeonColor = res.neonColor;
    neonColorPicker.value = currentNeonColor;
  }
}

function applyNeonColor(color) {
  document.documentElement.style.setProperty('--neon-color', color);
  const buttons = document.querySelectorAll('.neon-btn');
  buttons.forEach(btn => btn.style.setProperty('--btn-color', color));
}

// -----------------------------
// Ask background to apply config to tab/domain
// -----------------------------
async function ensureDomainEnforced(domain) {
  if (!domain) return;
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'enforceDomain',
      domain,
      tabId: currentTab ? currentTab.id : undefined
    });

    // response.success is true when background managed to propagate
    if (!response || !response.success) {
      // only warn, don't break UI
      console.warn('Could not force configuration application in tab.');
    }
  } catch (e) {
    console.warn('Error requesting enforceDomain:', e);
  }
}

// -----------------------------
// UI
// -----------------------------
function updateUI() {
  // Show "percentage" equivalent to multiplier * 100 (e.g.: multiplier 1.0 => 100%)
  const displayPercent = Math.round(currentConfig.volume * 100);
  volumeSlider.value = Math.min(500, displayPercent);
  currentVolume.textContent = `${displayPercent}%`;

  if (currentConfig.muted || currentConfig.volume === 0) {
    muteButton.innerHTML = '<span class="btn-icon">🔊</span>Unmute';
    muteButton.style.setProperty('--btn-color', '#44ff44');
  } else {
    muteButton.innerHTML = '<span class="btn-icon">🔇</span>Mute';
    muteButton.style.setProperty('--btn-color', '#ff4444');
  }
}

// -----------------------------
// EVENTS
// -----------------------------
volumeSlider.addEventListener('input', async (e) => {
  const volume = parseInt(e.target.value, 10) / 100; // slider -> multiplier
  currentConfig.volume = volume;
  currentConfig.muted = volume === 0;

  await saveDomainConfig();
  // Ask background to apply it to domain tab(s)
  await ensureDomainEnforced(currentConfig.domain);
  updateUI();
});

muteButton.addEventListener('click', async () => {
  const muted = !currentConfig.muted;
  currentConfig.muted = muted;
  currentConfig.volume = muted ? 0 : 1;

  await saveDomainConfig();
  await ensureDomainEnforced(currentConfig.domain);
  updateUI();
});

resetButton.addEventListener('click', async () => {
  currentConfig.volume = 1.0;
  currentConfig.muted = false;

  await saveDomainConfig();
  await ensureDomainEnforced(currentConfig.domain);
  updateUI();
});

maxButton.addEventListener('click', async () => {
  currentConfig.volume = 5.0;
  currentConfig.muted = false;

  await saveDomainConfig();
  await ensureDomainEnforced(currentConfig.domain);
  updateUI();
});

// -----------------------------
// Color Presets
// -----------------------------
neonColorPicker.addEventListener('input', (e) => {
  currentNeonColor = e.target.value;
  applyNeonColor(currentNeonColor);
  chrome.storage.local.set({ neonColor: currentNeonColor });
});

document.querySelectorAll('.color-preset').forEach(preset => {
  preset.addEventListener('click', (e) => {
    const color = e.target.getAttribute('data-color');
    currentNeonColor = color;
    neonColorPicker.value = color;
    applyNeonColor(color);
    chrome.storage.local.set({ neonColor: color });

    document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('active'));
    e.target.classList.add('active');
  });
});