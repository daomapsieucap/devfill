/**
 * DevFill options page script.
 * Presets are edited as raw JSON key/value pairs (see PRESET_KEY_MAP in
 * content.js for which keys DevFill recognizes out of the box - any
 * other key is preserved but won't be auto-matched to a field).
 *
 * All preset mutations go through `DevFillPresetStore` (lib/presetStore.js)
 * so the auto-push-to-gist hook stays centralized there instead of being
 * duplicated at every call site here.
 */
(function () {
  'use strict';

  // ---- Preset list/editor elements ---------------------------------------

  const presetListEl = document.getElementById('preset-list');
  const newPresetBtn = document.getElementById('new-preset-btn');
  const emptyState = document.getElementById('empty-state');
  const form = document.getElementById('preset-form');
  const nameInput = document.getElementById('preset-name-input');
  const jsonInput = document.getElementById('preset-json-input');
  const jsonError = document.getElementById('json-error');
  const deleteBtn = document.getElementById('delete-preset-btn');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFileInput = document.getElementById('import-file-input');

  // ---- Sync section elements ----------------------------------------------

  const patInput = document.getElementById('pat-input');
  const gistIdInput = document.getElementById('gist-id-input');
  const createGistBtn = document.getElementById('create-gist-btn');
  const useGistBtn = document.getElementById('use-gist-btn');
  const autoSyncToggle = document.getElementById('auto-sync-toggle');
  const lastSyncedText = document.getElementById('last-synced-text');
  const syncNowBtn = document.getElementById('sync-now-btn');
  const forcePullBtn = document.getElementById('force-pull-btn');
  const forcePushBtn = document.getElementById('force-push-btn');
  const syncMsg = document.getElementById('sync-msg');
  const syncDot = document.getElementById('sync-status-dot');
  const syncStatusText = document.getElementById('sync-status-text');

  let presets = {};
  let settings = {};
  let syncConfig = {};
  let selectedName = null; // name currently loaded in the editor
  let isNew = false;

  // ---- Preset list/editor -------------------------------------------------

  async function loadState() {
    presets = await DevFillPresetStore.getPresets();
    settings = await DevFillPresetStore.getSettings();
    renderList();
  }

  function renderList() {
    presetListEl.innerHTML = '';
    Object.keys(presets).forEach((name) => {
      const li = document.createElement('li');
      li.textContent = name;
      li.className = 'preset-list-item' + (name === selectedName ? ' active' : '');
      li.addEventListener('click', () => selectPreset(name));
      presetListEl.appendChild(li);
    });
  }

  function selectPreset(name) {
    selectedName = name;
    isNew = false;
    nameInput.value = name;
    jsonInput.value = JSON.stringify(presets[name], null, 2);
    jsonError.textContent = '';
    deleteBtn.hidden = false;
    showForm();
    renderList();
  }

  function startNewPreset() {
    selectedName = null;
    isNew = true;
    nameInput.value = '';
    // Every key DevFill auto-matches (see PRESET_KEY_MAP in content.js /
    // "Recognized field keys" in the README), pre-filled blank so a new
    // preset can just be edited in place instead of looked up elsewhere.
    jsonInput.value = JSON.stringify(
      {
        firstName: '',
        lastName: '',
        fullName: '',
        email: '',
        phone: '',
        company: '',
        jobTitle: '',
        website: '',
        username: '',
        password: '',
        address: '',
        address2: '',
        city: '',
        state: '',
        zip: '',
        country: '',
        message: '',
        birthDate: '',
        age: ''
      },
      null,
      2
    );
    jsonError.textContent = '';
    deleteBtn.hidden = true;
    showForm();
    nameInput.focus();
    renderList();
  }

  function showForm() {
    emptyState.hidden = true;
    form.hidden = false;
  }

  function closeForm() {
    selectedName = null;
    form.hidden = true;
    emptyState.hidden = false;
    renderList();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      jsonError.textContent = 'Preset name is required.';
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonInput.value);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Must be a JSON object of key/value pairs.');
      }
    } catch (err) {
      jsonError.textContent = 'Invalid JSON: ' + err.message;
      return;
    }

    const store = await DevFillPresetStore.savePreset(name, parsed, isNew ? null : selectedName);
    presets = store.presets;
    jsonError.textContent = '';
    selectPreset(name);
  });

  deleteBtn.addEventListener('click', async () => {
    if (!selectedName || !presets[selectedName]) return;
    if (!confirm(`Delete preset "${selectedName}"?`)) return;

    const store = await DevFillPresetStore.deletePreset(selectedName);
    presets = store.presets;

    if (settings.lastUsedPreset === selectedName) {
      settings.lastUsedPreset = Object.keys(presets)[0] || '';
      await DevFillPresetStore.setSettings(settings);
    }

    closeForm();
  });

  newPresetBtn.addEventListener('click', startNewPreset);

  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'devfill-presets.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  importBtn.addEventListener('click', () => importFileInput.click());

  importFileInput.addEventListener('change', async () => {
    const file = importFileInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Root of imported JSON must be an object of { presetName: {fields} }.');
      }
      const store = await DevFillPresetStore.importPresets(parsed, 'merge');
      presets = store.presets;
      closeForm();
      alert(`Imported ${Object.keys(parsed).length} preset(s).`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      importFileInput.value = '';
    }
  });

  // ---- Sync section ---------------------------------------------------------

  async function loadSyncState() {
    syncConfig = await DevFillPresetStore.getSyncConfig();
    patInput.value = syncConfig.githubPat || '';
    gistIdInput.value = syncConfig.gistId || '';
    autoSyncToggle.checked = !!(syncConfig.autoPullOnStartup && syncConfig.autoPushOnChange);
    renderSyncStatus();
  }

  function renderSyncStatus() {
    const configured = !!(syncConfig.githubPat && syncConfig.gistId);
    let color = 'gray';
    let label = 'Not configured';
    let title = 'Add a PAT and Gist ID below to enable sync.';

    if (configured) {
      if (syncConfig.lastSyncStatus === 'synced') {
        color = 'green'; label = 'In sync'; title = 'Local presets match the gist.';
      } else if (syncConfig.lastSyncStatus === 'error') {
        color = 'red'; label = 'Sync error'; title = syncConfig.lastSyncError || 'The last sync attempt failed.';
      } else if (syncConfig.lastSyncStatus === 'pending') {
        color = 'yellow'; label = 'Local changes pending'; title = 'Local presets changed since the last sync.';
      } else {
        color = 'yellow'; label = 'Not yet synced'; title = 'Configured but never synced - use Sync Now.';
      }
    }

    syncDot.className = 'sync-dot sync-dot-' + color;
    syncDot.title = title;
    syncStatusText.textContent = label;
    lastSyncedText.textContent = syncConfig.lastSyncedAt ? formatTimestamp(syncConfig.lastSyncedAt) : 'Never';

    syncNowBtn.disabled = !configured;
    forcePullBtn.disabled = !configured;
    forcePushBtn.disabled = !configured;
    createGistBtn.disabled = !syncConfig.githubPat;
    useGistBtn.disabled = !syncConfig.githubPat;
  }

  function formatTimestamp(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch (e) {
      return iso;
    }
  }

  function showSyncMsg(text, isError) {
    syncMsg.textContent = text;
    syncMsg.classList.toggle('status-error', !!isError);
  }

  function friendlyError(err) {
    if (err && err.name === 'GistSyncError') return err.message;
    return 'Unexpected error: ' + (err && err.message ? err.message : String(err));
  }

  patInput.addEventListener('change', async () => {
    syncConfig = await DevFillPresetStore.setSyncConfig({ githubPat: patInput.value.trim() });
    renderSyncStatus();
  });

  gistIdInput.addEventListener('change', async () => {
    syncConfig = await DevFillPresetStore.setSyncConfig({ gistId: gistIdInput.value.trim() });
    renderSyncStatus();
  });

  autoSyncToggle.addEventListener('change', async () => {
    syncConfig = await DevFillPresetStore.setSyncConfig({
      autoPullOnStartup: autoSyncToggle.checked,
      autoPushOnChange: autoSyncToggle.checked
    });
  });

  createGistBtn.addEventListener('click', async () => {
    if (!syncConfig.githubPat) { showSyncMsg('Enter a GitHub PAT first.', true); return; }
    createGistBtn.disabled = true;
    showSyncMsg('Creating gist...');
    try {
      const { gistId } = await DevFillGistSync.createGist(syncConfig.githubPat);
      gistIdInput.value = gistId;
      syncConfig = await DevFillPresetStore.setSyncConfig({
        gistId,
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'synced',
        lastSyncError: null
      });
      showSyncMsg('Created an empty gist. Use "Sync Now" to upload your local presets.');
    } catch (err) {
      showSyncMsg(friendlyError(err), true);
    } finally {
      renderSyncStatus();
    }
  });

  useGistBtn.addEventListener('click', async () => {
    const id = gistIdInput.value.trim();
    if (!id) { showSyncMsg('Enter a gist ID first.', true); return; }
    if (!syncConfig.githubPat) { showSyncMsg('Enter a GitHub PAT first.', true); return; }
    syncConfig = await DevFillPresetStore.setSyncConfig({ gistId: id });
    await handlePull({ force: true, skipConfirm: true });
  });

  syncNowBtn.addEventListener('click', handleSyncNow);
  forcePullBtn.addEventListener('click', () => handlePull({ force: true }));
  forcePushBtn.addEventListener('click', () => handlePush({ force: true }));

  // Figures out the direction itself instead of making the user pick
  // Pull vs Push: whichever side (local or gist) has the newer
  // `updatedAt` wins, same rule the automatic background checks use.
  async function handleSyncNow() {
    syncConfig = await DevFillPresetStore.getSyncConfig();
    if (!syncConfig.githubPat || !syncConfig.gistId) { showSyncMsg('Set a PAT and Gist ID first.', true); return; }

    showSyncMsg('Checking gist...');
    try {
      const remote = await DevFillGistSync.fetchGist(syncConfig.githubPat, syncConfig.gistId);
      const local = await DevFillPresetStore.getStore();
      const remoteTime = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
      const localTime = local.updatedAt ? Date.parse(local.updatedAt) : 0;

      if (remoteTime > localTime) return handlePull({ force: false });
      if (localTime > remoteTime) return handlePush({ force: false });

      syncConfig = await DevFillPresetStore.setSyncConfig({
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'synced',
        lastSyncError: null
      });
      showSyncMsg('Already in sync.');
      renderSyncStatus();
    } catch (err) {
      syncConfig = await DevFillPresetStore.setSyncConfig({ lastSyncStatus: 'error', lastSyncError: err.message || 'Sync check failed.' });
      showSyncMsg(friendlyError(err), true);
      renderSyncStatus();
    }
  }

  async function handlePull({ force, skipConfirm }) {
    syncConfig = await DevFillPresetStore.getSyncConfig();
    if (!syncConfig.githubPat || !syncConfig.gistId) { showSyncMsg('Set a PAT and Gist ID first.', true); return; }

    showSyncMsg('Fetching gist...');
    try {
      const remote = await DevFillGistSync.fetchGist(syncConfig.githubPat, syncConfig.gistId);
      const local = await DevFillPresetStore.getStore();
      const remoteTime = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
      const localTime = local.updatedAt ? Date.parse(local.updatedAt) : 0;

      if (!force && localTime >= remoteTime) {
        showSyncMsg('Local presets are already up to date. Use "Force Pull" to overwrite anyway.');
        return;
      }

      if (!skipConfirm) {
        const diff = DevFillGistSync.diffPresets(local.presets, remote.presets);
        const summary = `Added: ${diff.added.length}   Updated: ${diff.updated.length}   Removed: ${diff.removed.length}   Unchanged: ${diff.unchanged.length}`;
        const warning = (force && localTime > remoteTime)
          ? 'Your local presets are newer than the gist. Force-pulling will discard those local changes.\n\n'
          : '';
        const proceed = confirm(`Pull from gist?\n\n${warning}${summary}\n\nThis replaces your local presets.`);
        if (!proceed) { showSyncMsg(''); return; }
      }

      await DevFillPresetStore.setStore(remote, { silent: true });
      syncConfig = await DevFillPresetStore.setSyncConfig({
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'synced',
        lastSyncError: null
      });

      presets = remote.presets;
      closeForm();
      showSyncMsg(`Pulled ${Object.keys(remote.presets).length} preset(s) from the gist.`);
    } catch (err) {
      syncConfig = await DevFillPresetStore.setSyncConfig({ lastSyncStatus: 'error', lastSyncError: err.message || 'Pull failed.' });
      showSyncMsg(friendlyError(err), true);
    } finally {
      renderSyncStatus();
    }
  }

  async function handlePush({ force }) {
    syncConfig = await DevFillPresetStore.getSyncConfig();
    if (!syncConfig.githubPat || !syncConfig.gistId) { showSyncMsg('Set a PAT and Gist ID first.', true); return; }

    showSyncMsg('Checking gist...');
    try {
      const remote = await DevFillGistSync.fetchGist(syncConfig.githubPat, syncConfig.gistId);
      const local = await DevFillPresetStore.getStore();
      const remoteTime = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
      const localTime = local.updatedAt ? Date.parse(local.updatedAt) : 0;

      if (!force && remoteTime > localTime) {
        showSyncMsg('The gist has changes newer than your last sync (maybe from another device). Use "Sync Now" to pull them, or "Force Push" to overwrite them.', true);
        return;
      }
      if (force && remoteTime > localTime) {
        const proceed = confirm('The gist has changes newer than your local copy. Force-pushing will overwrite them on GitHub.\n\nContinue?');
        if (!proceed) { showSyncMsg(''); return; }
      }

      showSyncMsg('Pushing...');
      const result = await DevFillGistSync.updateGist(syncConfig.githubPat, syncConfig.gistId, local.presets);
      await DevFillPresetStore.setStore(result.schema, { silent: true });
      syncConfig = await DevFillPresetStore.setSyncConfig({
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'synced',
        lastSyncError: null
      });
      showSyncMsg('Pushed local presets to the gist.');
    } catch (err) {
      syncConfig = await DevFillPresetStore.setSyncConfig({ lastSyncStatus: 'error', lastSyncError: err.message || 'Push failed.' });
      showSyncMsg(friendlyError(err), true);
    } finally {
      renderSyncStatus();
    }
  }

  // Keep the UI live if background.js changes syncConfig/presets (e.g. an
  // auto-pull, or an auto-push landing after its alarm fires).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.syncConfig) {
      syncConfig = Object.assign({}, syncConfig, changes.syncConfig.newValue);
      renderSyncStatus();
    }
    if (changes.presets && !form.contains(document.activeElement)) {
      presets = (changes.presets.newValue && changes.presets.newValue.presets) || {};
      renderList();
    }
  });

  if (location.hash === '#sync-section') {
    document.getElementById('sync-section').scrollIntoView({ behavior: 'smooth' });
  }

  loadState();
  loadSyncState();
  // Editing presets directly from this page (without ever opening the
  // popup) shouldn't miss out on the same JIT auto-pull check the popup
  // triggers on open - fire-and-forget, background.js does the real work.
  chrome.runtime.sendMessage({ action: 'devfill-check-remote', reason: 'options-open' }).catch(() => {});
})();
