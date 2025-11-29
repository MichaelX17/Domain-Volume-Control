// popup.js - Simplified for per-tab control

let currentConfig = {
  volume: 1.0, // Acts as our multiplier
  muted: false
};

const volumeSlider = document.getElementById('volumeSlider');
const currentVolumeLabel = document.getElementById('currentVolume');
const muteButton = document.getElementById('muteButton');
const resetButton = document.getElementById('resetButton');
const maxButton = document.getElementById('maxButton');

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
  } else {
    muteButton.innerHTML = '<span class="btn-icon">🔇</span>Mute';
  }
}

// -----------------------------
// EVENT LISTENERS
// -----------------------------
volumeSlider.addEventListener('input', async (e) => {
  const newVolume = parseInt(e.target.value, 10) / 100;
  currentConfig.volume = newVolume;
  // If user slides to 0, it's muted. If they slide away from 0, it's unmuted.
  if (newVolume > 0 && currentConfig.muted) {
    currentConfig.muted = false;
  }
  
  updateUI();
});

volumeSlider.addEventListener('change', async (e) => {
    // Fires when the user releases the slider
    await applyVolumeChange();
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
