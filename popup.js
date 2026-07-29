/**
 * DevFill popup script.
 * Loads presets/settings from storage, wires up the two fill buttons,
 * and forwards a "devfill-fill" message to the content script of the
 * active tab.
 */
(function () {
  'use strict';

  const presetSelect = document.getElementById('preset-select');
  const presetSelectWrap = document.getElementById('preset-select-wrap');
  const presetCountEl = document.getElementById('df-preset-count');
  const versionEl = document.getElementById('df-version');
  const fillPresetBtn = document.getElementById('fill-preset-btn');
  const fillRandomBtn = document.getElementById('fill-random-btn');
  const highlightToggle = document.getElementById('highlight-toggle');
  const highlightStateEl = document.getElementById('highlight-state');
  const manageLink = document.getElementById('manage-presets-link');
  const statusMsg = document.getElementById('status-msg');
  const lastFillLine = document.getElementById('last-fill-line');
  const syncGroupBtn = document.getElementById('sync-status-group');
  const syncDot = document.getElementById('sync-status-dot');
  const syncLabel = document.getElementById('sync-status-label');

  let presets = {};
  let settings = { lastUsedPreset: '', highlightFields: true, lastFill: null };

  versionEl.textContent = 'v' + chrome.runtime.getManifest().version;

  function showStatus(text, isError) {
    statusMsg.textContent = text;
    statusMsg.classList.toggle('status-error', !!isError);
    if (text) setTimeout(() => { statusMsg.textContent = ''; }, 2500);
  }

  function populatePresetDropdown() {
    presetSelect.innerHTML = '';
    const names = Object.keys(presets);
    presetCountEl.textContent = '01 · ' + names.length;

    if (names.length === 0) {
      presetSelectWrap.hidden = true;
      fillPresetBtn.disabled = true;
      return;
    }
    presetSelectWrap.hidden = false;
    fillPresetBtn.disabled = false;
    names.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      presetSelect.appendChild(opt);
    });
    presetSelect.value = names.includes(settings.lastUsedPreset) ? settings.lastUsedPreset : names[0];
  }

  // "2m ago" / "3h ago" / "5d ago" - popups are short-lived, so this is
  // computed once per open rather than kept ticking with a live timer.
  function formatRelativeTime(isoString) {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function renderLastFill() {
    const lastFill = settings.lastFill;
    if (!lastFill) {
      lastFillLine.innerHTML = '<span class="df-accent">#</span>no fills yet this session';
      return;
    }
    const where = lastFill.host ? ` on ${lastFill.host}` : '';
    const count = `${lastFill.count} field${lastFill.count === 1 ? '' : 's'}`;
    lastFillLine.innerHTML =
      `<span class="df-accent">#</span>last fill · ${formatRelativeTime(lastFill.at)} · ${count}${where}`;
  }

  async function loadState() {
    presets = await DevFillPresetStore.getPresets();
    settings = await DevFillPresetStore.getSettings();
    highlightToggle.checked = settings.highlightFields !== false;
    highlightStateEl.textContent = highlightToggle.checked ? 'on' : 'off';
    populatePresetDropdown();
    renderLastFill();
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
  // above, or from the user's own fill click below), or a preset change
  // arrives from another device via chrome.storage.sync, keep the dropdown
  // in sync with whatever background.js/another device just wrote.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (!DevFillPresetStore.isPresetStorageChange(changes, area)) return;
    presets = await DevFillPresetStore.getPresets();
    populatePresetDropdown();
  });

  // One dot has to summarize two independent sync paths: the automatic
  // chrome.storage.sync backend (see presetBackend in presetStore.js,
  // relevant to every user) and the opt-in GitHub Gist (relevant only if
  // configured). Chrome Sync being active is the normal "good" state for
  // most users, so it's checked first; Gist only overrides that when it
  // has something more specific/urgent to say (an error) or when it's the
  // only thing actually working (Chrome Sync degraded but Gist is caught up).
  async function loadSyncDot() {
    const config = await DevFillPresetStore.getSyncConfig();
    const gistConfigured = !!(config.githubPat && config.gistId);
    const chromeSyncOk = config.presetBackend === 'sync';

    let color = 'gray';
    let label = 'not synced';
    let pulse = false;
    let title = 'Presets are stored on this device only.';

    if (gistConfigured && config.lastSyncStatus === 'error') {
      color = 'red'; label = 'gist error';
      title = 'Gist sync error' + (config.lastSyncError ? `: ${config.lastSyncError}` : '.');
    } else if (chromeSyncOk) {
      color = 'green'; label = 'synced'; pulse = true;
      title = 'Presets sync automatically via Chrome Sync.';
    } else if (gistConfigured && config.lastSyncStatus === 'synced') {
      color = 'green'; label = 'gist synced'; pulse = true;
      title = 'Chrome Sync is unavailable - presets are synced via your Gist instead.';
    } else if (gistConfigured && config.lastSyncStatus === 'pending') {
      color = 'yellow'; label = 'gist pending'; pulse = true;
      title = 'Local changes are waiting to push to your Gist.';
    } else if (config.presetBackendDegradeReason) {
      color = 'red'; label = 'not synced';
      title = 'Chrome Sync is unavailable and no Gist is configured - presets are stored on this device only.';
    }

    syncDot.className = 'df-status-dot df-status-' + color + (pulse ? ' df-pulse' : '');
    syncLabel.textContent = label;
    syncGroupBtn.title = `${title} (click to manage)`;
  }

  syncGroupBtn.addEventListener('click', () => {
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

      let host = '';
      try { host = new URL(tab.url).hostname; } catch (e) { /* chrome:// or similar - leave blank */ }
      settings.lastFill = { at: new Date().toISOString(), count, host };
      await DevFillPresetStore.setSettings(settings);
      renderLastFill();
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
    highlightStateEl.textContent = highlightToggle.checked ? 'on' : 'off';
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
