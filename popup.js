/**
 * DevFill popup script.
 * Loads presets/settings from storage, wires up the two fill buttons,
 * and forwards a "devfill-fill" message to the content script of the
 * active tab.
 */
(function () {
  'use strict';

  const presetSelect = document.getElementById('preset-select');
  const fillPresetBtn = document.getElementById('fill-preset-btn');
  const fillRandomBtn = document.getElementById('fill-random-btn');
  const highlightToggle = document.getElementById('highlight-toggle');
  const manageLink = document.getElementById('manage-presets-link');
  const statusMsg = document.getElementById('status-msg');
  const syncDot = document.getElementById('sync-status-dot');

  let presets = {};
  let settings = { lastUsedPreset: '', highlightFields: true };

  function showStatus(text, isError) {
    statusMsg.textContent = text;
    statusMsg.classList.toggle('status-error', !!isError);
    if (text) setTimeout(() => { statusMsg.textContent = ''; }, 2500);
  }

  function populatePresetDropdown() {
    presetSelect.innerHTML = '';
    const names = Object.keys(presets);
    if (names.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No presets - add one in Manage Presets';
      opt.disabled = true;
      presetSelect.appendChild(opt);
      fillPresetBtn.disabled = true;
      return;
    }
    fillPresetBtn.disabled = false;
    names.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      presetSelect.appendChild(opt);
    });
    presetSelect.value = names.includes(settings.lastUsedPreset) ? settings.lastUsedPreset : names[0];
  }

  async function loadState() {
    presets = await DevFillPresetStore.getPresets();
    settings = await DevFillPresetStore.getSettings();
    highlightToggle.checked = settings.highlightFields !== false;
    populatePresetDropdown();
  }

  // Kicks background.js's throttled, ETag-conditional remote check so a
  // gist change made on another device shows up here without waiting for
  // the next browser startup. Fire-and-forget - loadState() above already
  // renders from local storage immediately; if this pulls something newer,
  // the chrome.storage.onChanged listener below refreshes the dropdown.
  function checkRemoteForChanges(reason) {
    chrome.runtime.sendMessage({ action: 'devfill-check-remote', reason }).catch(() => {});
  }

  // If a pull lands while the popup happens to be open (from the check
  // above, or from the user's own fill click below), keep the dropdown
  // in sync with whatever background.js just wrote to storage.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.presets) return;
    presets = (changes.presets.newValue && changes.presets.newValue.presets) || {};
    populatePresetDropdown();
  });

  async function loadSyncDot() {
    const config = await DevFillPresetStore.getSyncConfig();
    const configured = !!(config.githubPat && config.gistId);
    let color = 'gray';
    let label = 'not configured';
    if (configured) {
      if (config.lastSyncStatus === 'synced') { color = 'green'; label = 'in sync'; }
      else if (config.lastSyncStatus === 'error') { color = 'red'; label = 'error: ' + (config.lastSyncError || 'last sync failed'); }
      else { color = 'yellow'; label = 'local changes pending'; }
    }
    syncDot.className = 'sync-dot sync-dot-' + color;
    syncDot.title = 'Sync: ' + label + ' (click to manage)';
  }

  syncDot.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + '#sync-section' });
  });

  async function sendFillMessage(payload) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      showStatus('No active tab found.', true);
      return;
    }
    try {
      const response = await chrome.tabs.sendMessage(tab.id, Object.assign({ action: 'devfill-fill' }, payload));
      const count = response && typeof response.filledCount === 'number' ? response.filledCount : 0;
      showStatus(`Filled ${count} field${count === 1 ? '' : 's'}.`);
    } catch (err) {
      showStatus('Could not reach this page (try reloading it).', true);
    }
  }

  fillPresetBtn.addEventListener('click', async () => {
    const name = presetSelect.value;
    if (!name || !presets[name]) {
      showStatus('Select a preset first.', true);
      return;
    }
    settings.lastUsedPreset = name;
    await DevFillPresetStore.setSettings(settings);
    // Fire-and-forget - don't make the fill wait on a network round trip.
    // The popup-open check (below) already made the local copy near-certain
    // to be current by the time the user gets around to clicking this.
    checkRemoteForChanges('pre-fill');
    sendFillMessage({ preset: presets[name], random: false, highlight: highlightToggle.checked });
  });

  fillRandomBtn.addEventListener('click', () => {
    checkRemoteForChanges('pre-fill');
    sendFillMessage({ preset: {}, random: true, highlight: highlightToggle.checked });
  });

  highlightToggle.addEventListener('change', async () => {
    settings.highlightFields = highlightToggle.checked;
    await DevFillPresetStore.setSettings(settings);
  });

  manageLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  loadState();
  loadSyncDot();
  checkRemoteForChanges('popup-open');
})();
