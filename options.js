/**
 * DevFill options page script.
 * Presets are edited as raw JSON key/value pairs (see PRESET_KEY_MAP in
 * content.js for which keys DevFill recognizes out of the box - any
 * other key is preserved but won't be auto-matched to a field).
 */
(function () {
  'use strict';

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

  let presets = {};
  let settings = {};
  let selectedName = null; // name currently loaded in the editor
  let isNew = false;

  async function loadState() {
    const stored = await chrome.storage.local.get(['presets', 'settings']);
    presets = stored.presets || {};
    settings = stored.settings || {};
    renderList();
  }

  async function persistPresets() {
    await chrome.storage.local.set({ presets });
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
    jsonInput.value = JSON.stringify(
      { firstName: '', lastName: '', email: '', phone: '', company: '', message: '' },
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

    // Renaming: drop the old key if the name changed.
    if (!isNew && selectedName && selectedName !== name) {
      delete presets[selectedName];
    }

    presets[name] = parsed;
    await persistPresets();
    jsonError.textContent = '';
    selectPreset(name);
  });

  deleteBtn.addEventListener('click', async () => {
    if (!selectedName || !presets[selectedName]) return;
    if (!confirm(`Delete preset "${selectedName}"?`)) return;

    delete presets[selectedName];
    if (settings.lastUsedPreset === selectedName) {
      settings.lastUsedPreset = Object.keys(presets)[0] || '';
      await chrome.storage.local.set({ settings });
    }
    await persistPresets();

    selectedName = null;
    form.hidden = true;
    emptyState.hidden = false;
    renderList();
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
      // Merge: imported names overwrite existing names with the same key.
      presets = Object.assign({}, presets, parsed);
      await persistPresets();
      selectedName = null;
      form.hidden = true;
      emptyState.hidden = false;
      renderList();
      alert(`Imported ${Object.keys(parsed).length} preset(s).`);
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      importFileInput.value = '';
    }
  });

  loadState();
})();
