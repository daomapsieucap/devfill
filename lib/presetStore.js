/**
 * DevFill preset storage.
 *
 * All preset reads/writes funnel through this module so the auto-push
 * hook (a `devfill-presets-changed` broadcast picked up by background.js)
 * only has to live in one place, no matter which page (options, popup)
 * triggers the mutation.
 *
 * Local storage layout (`chrome.storage.local`):
 *   presets:    { version, updatedAt, presets: { [name]: {fields} } }
 *               - identical shape to the Gist's devfill-presets.json file,
 *                 so pulling/pushing never needs adapter logic.
 *   settings:   { lastUsedPreset, highlightFields }        (unrelated to sync)
 *   syncConfig: { githubPat, gistId, autoPullOnStartup, autoPushOnChange,
 *                 lastSyncedAt, lastSyncStatus, lastSyncError, lastEtag }
 *
 * Exposed as `self.DevFillPresetStore` (works in both regular pages and
 * the MV3 service worker).
 */
(function (root) {
  'use strict';

  const STORE_KEY = 'presets';
  const SETTINGS_KEY = 'settings';
  const SYNC_CONFIG_KEY = 'syncConfig';

  const DEFAULT_STORE = { version: 1, updatedAt: null, presets: {} };
  // lastFill: { at: ISOString, count: number, host: string } | null - local
  // UI state (like the rest of `settings`), not synced via the Gist.
  const DEFAULT_SETTINGS = { lastUsedPreset: '', highlightFields: true, lastFill: null };
  const DEFAULT_SYNC_CONFIG = {
    githubPat: '',
    gistId: '',
    autoPullOnStartup: true,
    autoPushOnChange: true,
    lastSyncedAt: null,
    // 'unconfigured' | 'synced' | 'pending' | 'error'
    lastSyncStatus: 'unconfigured',
    lastSyncError: null,
    // ETag of the last gist snapshot we fetched or pushed - lets
    // background.js send conditional GETs (If-None-Match) so an unchanged
    // gist costs a free 304 instead of a full response.
    lastEtag: null
  };

  // ---- presets store ----------------------------------------------------

  async function getStore() {
    const stored = await chrome.storage.local.get(STORE_KEY);
    const store = stored[STORE_KEY];
    if (!store || typeof store !== 'object') return Object.assign({}, DEFAULT_STORE, { presets: {} });
    return {
      version: store.version || 1,
      updatedAt: store.updatedAt || null,
      presets: store.presets || {}
    };
  }

  async function getPresets() {
    return (await getStore()).presets;
  }

  // Low-level overwrite. `silent: true` skips the auto-push broadcast -
  // used when a store update is *itself* the result of a sync (pull), so
  // it doesn't immediately trigger a pointless push right back out.
  async function setStore(store, options) {
    const silent = !!(options && options.silent);
    await chrome.storage.local.set({ [STORE_KEY]: store });
    if (!silent) await notifyChanged(store);
    return store;
  }

  async function savePreset(name, fields, previousName) {
    const store = await getStore();
    if (previousName && previousName !== name) delete store.presets[previousName];
    store.presets[name] = fields;
    store.updatedAt = new Date().toISOString();
    await setStore(store);
    return store;
  }

  async function deletePreset(name) {
    const store = await getStore();
    delete store.presets[name];
    store.updatedAt = new Date().toISOString();
    await setStore(store);
    return store;
  }

  // mode: 'merge' (default, imported names overwrite matching existing ones)
  //       'replace' (imported presets fully replace the local set)
  async function importPresets(incoming, mode) {
    const store = await getStore();
    store.presets = mode === 'replace' ? Object.assign({}, incoming) : Object.assign({}, store.presets, incoming);
    store.updatedAt = new Date().toISOString();
    await setStore(store);
    return store;
  }

  // Marks the local state as "pending" (if sync is configured) and pings
  // the service worker so it can debounce an auto-push. Fire-and-forget:
  // failures here (e.g. context invalidated mid-reload) just mean the
  // next mutation - or a manual "Push Now" - will catch up.
  async function notifyChanged(store) {
    const config = await getSyncConfig();
    if (config.githubPat && config.gistId) {
      await setSyncConfig({ lastSyncStatus: 'pending' });
    }
    try {
      chrome.runtime.sendMessage({ action: 'devfill-presets-changed', updatedAt: store.updatedAt }).catch(() => {});
    } catch (e) {
      // Extension context invalidated - ignore.
    }
  }

  // ---- settings (unrelated to sync) --------------------------------------

  async function getSettings() {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return Object.assign({}, DEFAULT_SETTINGS, stored[SETTINGS_KEY] || {});
  }

  async function setSettings(settings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }

  // ---- sync config --------------------------------------------------------

  async function getSyncConfig() {
    const stored = await chrome.storage.local.get(SYNC_CONFIG_KEY);
    return Object.assign({}, DEFAULT_SYNC_CONFIG, stored[SYNC_CONFIG_KEY] || {});
  }

  async function setSyncConfig(partial) {
    const current = await getSyncConfig();
    const next = Object.assign({}, current, partial);
    await chrome.storage.local.set({ [SYNC_CONFIG_KEY]: next });
    return next;
  }

  root.DevFillPresetStore = {
    getStore,
    setStore,
    getPresets,
    savePreset,
    deletePreset,
    importPresets,
    getSettings,
    setSettings,
    getSyncConfig,
    setSyncConfig
  };
})(self);
