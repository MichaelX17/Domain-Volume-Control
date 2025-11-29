// popup.js - Simplified for per-tab control

let currentConfig = {
  volume: 1.0, // Acts as our multiplier
  muted: false
};

let currentNeonColor = '#00ff00';

const volumeSlider = document.getElementById('volumeSlider');
const currentVolumeLabel = document.getElementById('currentVolume');
const muteButton = document.getElementById('muteButton');
const resetButton = document.getElementById('resetButton');
const maxButton = document.getElementById('maxButton');
const neonColorPicker = document.getElementById('neonColor');

// Debounce function
function debounce(func, delay) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), delay);
  };
}

// Debounced version of applyVolumeChange
const debouncedApplyVolumeChange = debounce(applyVolumeChange, 100); // 100ms debounce

// -----------------------------
// INITIALIZATION
// -----------------------------
document.addEventListener('DOMContentLoaded', async () => {
  // Load the current tab's state
  try {
    const state = await chrome.runtime.sendMessage({ action: 'getTabState' });
    if (state && typeof state.volume === 'number') {
      currentConfig.volume = state.volume;
      currentConfig.muted = state.muted;
    }
  } catch (e) {
    // This can happen if the content script isn't ready. Default is fine.
    console.warn("Could not get tab state, using default.", e);
  }

  await loadNeonColor();
  applyNeonColor(currentNeonColor);
  updateUI();
});


// -----------------------------
// Send volume changes to the background script
// -----------------------------
async function applyVolumeChange() {
  try {
    await chrome.runtime.sendMessage({
      action: 'setTabVolume',
      multiplier: currentConfig.volume,
      muted: currentConfig.muted
    });
  } catch (e) {
    console.error("Failed to set tab volume", e);
    // You could add some UI feedback here if needed
  }
}

// -----------------------------
// UI Update
// -----------------------------
function updateUI() {
  const displayPercent = Math.round(currentConfig.volume * 100);
  volumeSlider.value = Math.min(500, displayPercent);
  currentVolumeLabel.textContent = `${displayPercent}%`;

  if (currentConfig.muted || currentConfig.volume === 0) {
    muteButton.innerHTML = '<span class="btn-icon">🔊</span>Unmute';
    muteButton.style.setProperty('--btn-color', '#44ff44'); // Green for Unmute
  } else {
    muteButton.innerHTML = '<span class="btn-icon">🔇</span>Mute';
    muteButton.style.setProperty('--btn-color', '#ff4444'); // Red for Mute
  }
}

// -----------------------------
// NEON COLOR
// -----------------------------
async function loadNeonColor() {
  const res = await chrome.storage.local.get(['neonColor']);
  if (res.neonColor) {
    currentNeonColor = res.neonColor;
    neonColorPicker.value = currentNeonColor;
  }
}

function applyNeonColor(color) {
  // Set the main theme color for the slider
  document.documentElement.style.setProperty('--neon-color', color);
  
  // Apply the theme color to generic buttons, but not the mute button
  resetButton.style.setProperty('--btn-color', color);
  maxButton.style.setProperty('--btn-color', color);
}

// -----------------------------
// EVENT LISTENERS
// -----------------------------
volumeSlider.addEventListener('input', (e) => { // Removed async here
  const newVolume = parseInt(e.target.value, 10) / 100;
  currentConfig.volume = newVolume;
  // If user slides to 0, it's muted. If they slide away from 0, it's unmuted.
  if (newVolume > 0 && currentConfig.muted) {
    currentConfig.muted = false;
  }
  
  updateUI();
  debouncedApplyVolumeChange(); // Call debounced function
});

muteButton.addEventListener('click', async () => {
  currentConfig.muted = !currentConfig.muted;
  // If unmuting and volume is 0, set to 100% as a sensible default
  if (!currentConfig.muted && currentConfig.volume === 0) {
    currentConfig.volume = 1.0;
  }
  updateUI();
  await applyVolumeChange();
});

resetButton.addEventListener('click', async () => {
  currentConfig.volume = 1.0;
  currentConfig.muted = false;
  updateUI();
  await applyVolumeChange();
});

maxButton.addEventListener('click', async () => {
  currentConfig.volume = 5.0;
  currentConfig.muted = false;
  updateUI();
  await applyVolumeChange();
});

// Color Presets
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
