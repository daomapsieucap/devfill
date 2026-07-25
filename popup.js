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
    sendFillMessage({ preset: presets[name], random: false, highlight: highlightToggle.checked });
  });

  fillRandomBtn.addEventListener('click', () => {
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
})();
