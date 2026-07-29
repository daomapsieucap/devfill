/**
 * DevFill preset storage.
 *
 * All preset reads/writes funnel through this module so the auto-push
 * hook (a `devfill-presets-changed` broadcast picked up by background.js)
 * only has to live in one place, no matter which page (options, popup)
 * triggers the mutation.
 *
 * Presets live primarily in `chrome.storage.sync` (once migrated - see
 * `ensureMigrated`), sharded across multiple keys so a single preset's
 * ~1KB never gets anywhere near the 8KB-per-item cap, and the collection
 * as a whole doesn't hit that cap the way one combined blob would:
 *   df_sync_index:        { version, updatedAt, nextSeq, presets: { [name]: shardId } }
 *   df_sync_shard_<id>:   { ...preset fields }  - one key per preset
 *
 * `chrome.storage.local` layout:
 *   presets:    { version, updatedAt, presets: { [name]: {fields} } }
 *               - always kept current on every write, regardless of which
 *                 backend is authoritative, so an edit is never lost even
 *                 if the sync write fails. Also the sole backend before
 *                 the one-time migration runs. Identical shape to the
 *                 Gist's devfill-presets.json file and to the reassembled
 *                 sync-backend shape, so pulling/pushing never needs
 *                 adapter logic.
 *   settings:   { lastUsedPreset, highlightFields }        (unrelated to sync)
 *   syncConfig: { githubPat, gistId, autoPullOnStartup, autoPushOnChange,
 *                 lastSyncedAt, lastSyncStatus, lastSyncError, lastEtag,
 *                 presetBackend, presetBackendDegradedAt,
 *                 presetBackendDegradeReason, migrationAttempted }
 *
 * chrome.storage.sync gives extensions no way to tell whether the user is
 * actually signed in / has sync enabled - a write can succeed locally and
 * simply never propagate, with nothing surfaced to us. The only failure
 * Chrome does report is a quota/rate rejection on write. So "fallback"
 * here means: reliably fall back to local-only storage (with GitHub Gist
 * sync, if the user has that configured, as the durable cross-device
 * path) on a write failure - not on "sync silently isn't working".
 *
 * Exposed as `self.DevFillPresetStore` (works in both regular pages and
 * the MV3 service worker).
 */
(function (root) {
  'use strict';

  const STORE_KEY = 'presets';
  const SETTINGS_KEY = 'settings';
  const SYNC_CONFIG_KEY = 'syncConfig';
  const SYNC_INDEX_KEY = 'df_sync_index';
  const SYNC_SHARD_PREFIX = 'df_sync_shard_';

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
    lastEtag: null,
    // 'local' | 'sync' - which backend getStore()/setStore() currently
    // treat as authoritative for presets. Starts 'local' until
    // ensureMigrated() runs once.
    presetBackend: 'local',
    presetBackendDegradedAt: null,
    // null | 'item_quota' | 'total_quota' | 'max_items' | 'write_rate' | 'unknown'
    presetBackendDegradeReason: null,
    migrationAttempted: false
  };

  // ---- presets store ----------------------------------------------------

  async function readFromLocalBackend() {
    const stored = await chrome.storage.local.get(STORE_KEY);
    const store = stored[STORE_KEY];
    if (!store || typeof store !== 'object') return Object.assign({}, DEFAULT_STORE, { presets: {} });
    return {
      version: store.version || 1,
      updatedAt: store.updatedAt || null,
      presets: store.presets || {}
    };
  }

  // Reassembles the sharded sync-backend shape into the same
  // {version, updatedAt, presets} shape readFromLocalBackend returns, so
  // every other caller (Gist push/pull, diffPresets, etc.) never needs to
  // know which backend is actually in play.
  async function readFromSyncBackend() {
    const indexStored = await chrome.storage.sync.get(SYNC_INDEX_KEY);
    const index = indexStored[SYNC_INDEX_KEY];
    if (!index || typeof index !== 'object') return Object.assign({}, DEFAULT_STORE, { presets: {} });

    const names = Object.keys(index.presets || {});
    const shardKeys = names.map((name) => SYNC_SHARD_PREFIX + index.presets[name]);
    const shardsStored = shardKeys.length ? await chrome.storage.sync.get(shardKeys) : {};

    const presets = {};
    names.forEach((name) => {
      const fields = shardsStored[SYNC_SHARD_PREFIX + index.presets[name]];
      if (fields && typeof fields === 'object') {
        presets[name] = fields;
      } else {
        // A partially-propagated multi-device state (shard not synced yet)
        // degrades to "temporarily fewer presets", not a broken read.
        console.warn(`[DevFill] Missing sync shard for preset "${name}" - skipping for now.`);
      }
    });

    return { version: index.version || 1, updatedAt: index.updatedAt || null, presets };
  }

  async function getStore() {
    const config = await getSyncConfig();
    if (config.presetBackend === 'sync') {
      try {
        return await readFromSyncBackend();
      } catch (err) {
        // A read failure is transient - unlike a write failure, it does not
        // flip presetBackend permanently. Just serve the local mirror for
        // this one call.
        console.warn('[DevFill] Reading from chrome.storage.sync failed, serving local mirror for this read:', err.message);
        return await readFromLocalBackend();
      }
    }
    return await readFromLocalBackend();
  }

  async function getPresets() {
    return (await getStore()).presets;
  }

  function classifySyncError(err) {
    const msg = (err && err.message) || '';
    if (/QUOTA_BYTES_PER_ITEM/i.test(msg)) return 'item_quota';
    if (/QUOTA_BYTES/i.test(msg)) return 'total_quota';
    if (/MAX_ITEMS/i.test(msg)) return 'max_items';
    if (/MAX_WRITE_OPERATIONS/i.test(msg)) return 'write_rate';
    return 'unknown';
  }

  // Rewrites every current shard + the index in a single batched
  // chrome.storage.sync.set() call - multiple keys in one call counts as
  // ONE write operation against the per-minute/per-hour write-op quotas,
  // which matters for bulk imports. Reuses existing shard ids for names
  // that already exist so unrelated devices' cached shard pointers stay
  // valid; mints new ids (never reused) for new names.
  async function writePresetsToSync(store) {
    const indexStored = await chrome.storage.sync.get(SYNC_INDEX_KEY);
    const prevIndex = indexStored[SYNC_INDEX_KEY] || { version: 1, updatedAt: null, nextSeq: 1, presets: {} };

    const names = Object.keys(store.presets || {});
    const nextPresetsIndex = {};
    let nextSeq = prevIndex.nextSeq || 1;
    const writeBatch = {};

    names.forEach((name) => {
      const shardId = (prevIndex.presets && prevIndex.presets[name]) || ('s' + nextSeq++);
      nextPresetsIndex[name] = shardId;
      writeBatch[SYNC_SHARD_PREFIX + shardId] = store.presets[name];
    });

    writeBatch[SYNC_INDEX_KEY] = {
      version: store.version || 1,
      updatedAt: store.updatedAt || new Date().toISOString(),
      nextSeq,
      presets: nextPresetsIndex
    };

    await chrome.storage.sync.set(writeBatch);

    // Clean up shards for presets that were renamed/deleted.
    const oldShardIds = new Set(Object.values(prevIndex.presets || {}));
    const newShardIds = new Set(Object.values(nextPresetsIndex));
    const orphanedKeys = Array.from(oldShardIds)
      .filter((id) => !newShardIds.has(id))
      .map((id) => SYNC_SHARD_PREFIX + id);
    if (orphanedKeys.length) await chrome.storage.sync.remove(orphanedKeys);
  }

  // A write failure is the only reliably-detectable "chrome.storage.sync
  // isn't working" signal (see the file header). Degrades permanently to
  // local-only storage and, if Gist is already configured, pings
  // background.js to push immediately rather than waiting on its 30s
  // debounce alarm - local plus Gist is now the only durable copy.
  async function handleSyncWriteFailure(err) {
    console.warn('[DevFill] chrome.storage.sync write failed, falling back to local-only storage:', err.message);
    await setSyncConfig({
      presetBackend: 'local',
      presetBackendDegradedAt: new Date().toISOString(),
      presetBackendDegradeReason: classifySyncError(err)
    });
    try {
      chrome.runtime.sendMessage({ action: 'devfill-presets-changed', urgent: true }).catch(() => {});
    } catch (e) {
      // Extension context invalidated - ignore.
    }
  }

  // Low-level overwrite. `silent: true` skips the auto-push broadcast -
  // used when a store update is *itself* the result of a sync (pull), so
  // it doesn't immediately trigger a pointless push right back out.
  async function setStore(store, options) {
    const silent = !!(options && options.silent);

    // Always keep the local mirror current, regardless of backend, so an
    // edit is never lost even if the sync write below fails.
    await chrome.storage.local.set({ [STORE_KEY]: store });

    const config = await getSyncConfig();
    if (config.presetBackend === 'sync') {
      try {
        await writePresetsToSync(store);
      } catch (err) {
        await handleSyncWriteFailure(err);
      }
    }

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

  // One-time (per install), non-destructive: copies whatever is in the
  // local `presets` key into the sync backend. Reuses setStore()'s normal
  // write-fallback path, so a migration failure (e.g. an existing user's
  // presets don't fit the sync quotas) automatically degrades back to
  // 'local' via handleSyncWriteFailure - no migration-specific error
  // handling needed. The local key is never deleted; it's the safety-net
  // mirror going forward regardless of outcome.
  async function ensureMigrated() {
    const config = await getSyncConfig();
    if (config.migrationAttempted) return;
    await migrateToSyncBackend();
  }

  // Same as ensureMigrated but callable on demand (e.g. a "Retry Chrome
  // Sync" button), without the migrationAttempted guard.
  async function migrateToSyncBackend() {
    const local = await readFromLocalBackend();
    // Optimistic flip before writing - if the write below fails,
    // setStore -> handleSyncWriteFailure flips it back to 'local' with the
    // real degrade reason, overriding this.
    await setSyncConfig({
      migrationAttempted: true,
      presetBackend: 'sync',
      presetBackendDegradedAt: null,
      presetBackendDegradeReason: null
    });
    await setStore(local, { silent: true });
    return await getSyncConfig();
  }

  // Marks the local state as "pending" (if sync is configured) and pings
  // the service worker so it can debounce an auto-push. Fire-and-forget:
  // failures here (e.g. context invalidated mid-reload) just mean the
  // next mutation - or a manual "Sync Now" - will catch up.
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

  // True when `changes`/`area` (as passed to a chrome.storage.onChanged
  // listener) reflect a preset mutation - either the always-written local
  // mirror, or a sync-area delta (index or any shard). Keeps knowledge of
  // the sharded key scheme inside this module so pages stay backend-agnostic.
  function isPresetStorageChange(changes, area) {
    if (area === 'local') return !!changes[STORE_KEY];
    if (area === 'sync') {
      if (changes[SYNC_INDEX_KEY]) return true;
      return Object.keys(changes).some((key) => key.indexOf(SYNC_SHARD_PREFIX) === 0);
    }
    return false;
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
    setSyncConfig,
    ensureMigrated,
    migrateToSyncBackend,
    isPresetStorageChange
  };
})(self);
