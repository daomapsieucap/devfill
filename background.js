/**
 * DevFill background service worker.
 * - Seeds default presets on first install.
 * - Auto-pulls from the configured Gist on browser startup / extension install.
 * - Also checks the Gist for changes just-in-time, whenever the user acts
 *   (opens the popup, fills a form, presses the shortcut) - throttled and
 *   ETag-conditional so it's cheap even when nothing changed.
 * - Pushes to the Gist whenever presets change locally, via chrome.alarms
 *   (durable across service worker restarts) rather than a bare timer.
 * - Handles the Alt+Shift+F keyboard shortcut to fill with the last used preset.
 */

importScripts('lib/presetStore.js', 'lib/gistSync.js');

const DEFAULT_PRESETS = {
  Default: {
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
  }
};

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const existing = await DevFillPresetStore.getStore();
    if (Object.keys(existing.presets).length === 0 && !existing.updatedAt) {
      await DevFillPresetStore.setStore(
        { version: 1, updatedAt: new Date().toISOString(), presets: DEFAULT_PRESETS },
        { silent: true }
      );
    }
    const settings = await DevFillPresetStore.getSettings();
    if (!settings.lastUsedPreset) {
      await DevFillPresetStore.setSettings({ lastUsedPreset: 'Default', highlightFields: true });
    }
  }
  runStartupAutoPull();
});

chrome.runtime.onStartup.addListener(() => {
  runStartupAutoPull();
});

// ---- Remote change checking (startup AND just-in-time) ---------------------
//
// One code path handles both "check once when the browser starts" and
// "check right before the user does something with a preset". It compares
// the Gist's `updatedAt` against the local copy's and only overwrites local
// presets if the remote copy is strictly newer. Never blocks the caller and
// never throws - failures are recorded in syncConfig for the popup/options
// page to surface.
const REMOTE_CHECK_THROTTLE_MS = 10 * 1000;
let lastRemoteCheckAt = 0; // module-scope only, so this resets if the worker restarts - that's fine, it just means the next check after a restart isn't throttled.

async function checkRemoteForChanges({ reason } = {}) {
  const now = Date.now();
  if (now - lastRemoteCheckAt < REMOTE_CHECK_THROTTLE_MS) return;
  lastRemoteCheckAt = now;

  // Push any queued local edit first. Otherwise a pull below could overwrite
  // an edit that hasn't reached the Gist yet - flushing preserves the
  // invariant that a pull never clobbers unpushed local changes.
  await flushPendingPushIfDue();

  const config = await DevFillPresetStore.getSyncConfig();
  // Reuses `autoPullOnStartup` as the single on/off switch for all automatic
  // remote checks, startup and just-in-time alike - the underlying operation
  // (compare timestamps, maybe overwrite local) is identical either way, and
  // one toggle is simpler for the user than two that always move together.
  if (!config.autoPullOnStartup || !config.githubPat || !config.gistId) return;

  try {
    const result = await DevFillGistSync.fetchGistIfChanged(config.githubPat, config.gistId, config.lastEtag);

    if (result.notModified) {
      await DevFillPresetStore.setSyncConfig({
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'synced'
      });
      return;
    }

    const local = await DevFillPresetStore.getStore();
    const remoteTime = result.schema.updatedAt ? Date.parse(result.schema.updatedAt) : 0;
    const localTime = local.updatedAt ? Date.parse(local.updatedAt) : 0;

    if (remoteTime > localTime) {
      await DevFillPresetStore.setStore(result.schema, { silent: true });
    }
    // Always adopt the fresh etag, even when we didn't apply the content
    // (local was already newer/equal) - it identifies this gist snapshot
    // regardless, so the next check compares against it instead of getting
    // another full 200 for content we've already seen.
    await DevFillPresetStore.setSyncConfig({
      lastEtag: result.etag,
      lastSyncedAt: new Date().toISOString(),
      lastSyncStatus: remoteTime > localTime ? 'synced' : (localTime > remoteTime ? 'pending' : 'synced'),
      lastSyncError: null
    });
  } catch (err) {
    console.error(`[DevFill] Remote check failed (${reason || 'unknown'}):`, err.message);
    await DevFillPresetStore.setSyncConfig({
      lastSyncStatus: 'error',
      lastSyncError: err.message || 'Remote check failed.'
    });
  }
}

async function runStartupAutoPull() {
  await checkRemoteForChanges({ reason: 'startup' });
}

// ---- Auto-push on change ---------------------------------------------------
//
// presetStore.js broadcasts `devfill-presets-changed` after any local
// create/edit/delete/import. Scheduled via chrome.alarms rather than
// setTimeout: MV3 service workers can be terminated while idle, and a
// pending setTimeout does NOT survive that, silently dropping the push.
// An alarm does survive it (the browser wakes the worker to fire it), at
// the cost of chrome.alarms' 30-second minimum delay - a real regression
// from the old 3s debounce, but flushPendingPushIfDue() (called from
// checkRemoteForChanges, i.e. on popup open / fill / shortcut) claws most
// of that latency back by pushing immediately the next time the user
// actually does something, instead of waiting out the full 30s.
const AUTO_PUSH_ALARM_NAME = 'devfill-push';

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_PUSH_ALARM_NAME) runAutoPush();
});

function scheduleAutoPush() {
  chrome.alarms.create(AUTO_PUSH_ALARM_NAME, { delayInMinutes: 0.5 });
}

async function flushPendingPushIfDue() {
  const alarm = await chrome.alarms.get(AUTO_PUSH_ALARM_NAME);
  if (!alarm) return;
  await chrome.alarms.clear(AUTO_PUSH_ALARM_NAME);
  await runAutoPush();
}

// Safe to call with nothing pending - it re-reads syncConfig/the store fresh
// every time and simply bails if sync isn't configured/enabled, so a stray
// or redundant call (e.g. from flushPendingPushIfDue finding no alarm is a
// no-op already, but even if it were called anyway) just re-pushes the
// current state, which is harmless.
async function runAutoPush() {
  const config = await DevFillPresetStore.getSyncConfig();
  if (!config.autoPushOnChange || !config.githubPat || !config.gistId) return;

  try {
    const store = await DevFillPresetStore.getStore();
    const result = await DevFillGistSync.updateGist(config.githubPat, config.gistId, store.presets);
    // Adopt the pushed schema's updatedAt, and its etag, locally so future
    // comparisons (both push-conflict checks and conditional GETs) agree.
    await DevFillPresetStore.setStore(result.schema, { silent: true });
    await DevFillPresetStore.setSyncConfig({
      lastEtag: result.etag,
      lastSyncedAt: new Date().toISOString(),
      lastSyncStatus: 'synced',
      lastSyncError: null
    });
  } catch (err) {
    console.error('[DevFill] Auto-push failed:', err.message);
    await DevFillPresetStore.setSyncConfig({
      lastSyncStatus: 'error',
      lastSyncError: err.message || 'Auto-push failed.'
    });
  }
}

// ---- Cross-context messages -------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;
  if (message.action === 'devfill-presets-changed') {
    scheduleAutoPush();
  } else if (message.action === 'devfill-check-remote') {
    // Fire-and-forget: no sendResponse call and no `return true`, so the
    // sender's chrome.runtime.sendMessage promise resolves immediately
    // instead of waiting on this.
    checkRemoteForChanges({ reason: message.reason });
  }
});

// ---- Keyboard shortcut ------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-last-preset') return;

  // Fire-and-forget, same as the popup's fill buttons - don't make the
  // shortcut feel laggy waiting on a network round trip.
  checkRemoteForChanges({ reason: 'pre-fill' });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const presets = await DevFillPresetStore.getPresets();
  const settings = await DevFillPresetStore.getSettings();
  const preset = (settings.lastUsedPreset && presets[settings.lastUsedPreset]) || {};

  chrome.tabs.sendMessage(tab.id, {
    action: 'devfill-fill',
    preset,
    random: false,
    highlight: settings.highlightFields !== false
  }).catch(() => {
    // No content script on this page (e.g. chrome:// URL) - nothing to do.
  });
});
