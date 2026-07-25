/**
 * DevFill background service worker.
 * - Seeds default presets on first install.
 * - Auto-pulls from the configured Gist on browser startup / extension install.
 * - Debounces an auto-push to the Gist whenever presets change locally.
 * - Handles the Alt+Shift+F keyboard shortcut to fill with the last used preset.
 */

importScripts('lib/presetStore.js', 'lib/gistSync.js');

const DEFAULT_PRESETS = {
  'Default User': {
    firstName: 'Jane',
    lastName: 'Doe',
    fullName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '(555) 123-4567',
    company: 'Acme Corp',
    jobTitle: 'Software Engineer',
    website: 'https://www.example.com',
    username: 'janedoe',
    password: 'DevFill!2024',
    address: '123 Maple St',
    address2: 'Apt 4B',
    city: 'Springfield',
    state: 'Illinois',
    zip: '62704',
    country: 'United States',
    message: 'This is sample test data filled in by DevFill.',
    birthDate: '1990-05-14',
    age: '34'
  },
  'Business Contact': {
    firstName: 'Michael',
    lastName: 'Chen',
    fullName: 'Michael Chen',
    email: 'michael.chen@example.org',
    phone: '(415) 555-0199',
    company: 'Blue Peak Solutions',
    jobTitle: 'VP of Operations',
    website: 'https://www.example.org',
    username: 'mchen',
    password: 'BizContact#88',
    address: '500 Market Street, Suite 2100',
    address2: '',
    city: 'San Francisco',
    state: 'California',
    zip: '94105',
    country: 'United States',
    message: 'Reaching out regarding a potential partnership opportunity.',
    birthDate: '1985-11-02',
    age: '39'
  },
  'Edge Cases': {
    firstName: "O'Bríen-Ééva",
    lastName: '张伟-里奇',
    fullName: "O'Bríen-Ééva 张伟-里奇",
    email: 'edge.case+test@sub.example.co.uk',
    phone: '+44 20 7946 0958',
    company: 'Non-Standard & Co., 丙公司',
    jobTitle: 'Head of “Special Projects”',
    website: 'https://xn--exmple-4ua.com/path?query=1&other=2',
    username: 'user.name+tag_99',
    password: 'P@ssw0rd! éèê 123',
    address: "42 Rüe d'Église, Apt № 3",
    address2: 'c/o Front Desk',
    city: 'São Paulo',
    state: 'Åland',
    zip: 'SW1A 1AA',
    country: 'Åland Islands',
    message: 'Line one.\nLine two with "quotes" and <tags> & symbols.\nEmoji: 🚀✨',
    birthDate: '1900-01-01',
    age: '0'
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
      await DevFillPresetStore.setSettings({ lastUsedPreset: 'Default User', highlightFields: true });
    }
  }
  runStartupAutoPull();
});

chrome.runtime.onStartup.addListener(() => {
  runStartupAutoPull();
});

// ---- Auto-pull on startup -------------------------------------------------
//
// Fetches the Gist, compares `updatedAt` timestamps, and only overwrites
// local presets if the remote copy is strictly newer. Never blocks the
// user and never throws - failures are recorded in syncConfig for the
// popup/options page to surface.
async function runStartupAutoPull() {
  const config = await DevFillPresetStore.getSyncConfig();
  if (!config.autoPullOnStartup || !config.githubPat || !config.gistId) return;

  try {
    const remote = await DevFillGistSync.fetchGist(config.githubPat, config.gistId);
    const local = await DevFillPresetStore.getStore();
    const remoteTime = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
    const localTime = local.updatedAt ? Date.parse(local.updatedAt) : 0;

    if (remoteTime > localTime) {
      await DevFillPresetStore.setStore(remote, { silent: true });
      await DevFillPresetStore.setSyncConfig({
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'synced',
        lastSyncError: null
      });
    } else {
      // Local is newer (or equal) - a push will handle reconciling it.
      await DevFillPresetStore.setSyncConfig({
        lastSyncStatus: localTime > remoteTime ? 'pending' : 'synced'
      });
    }
  } catch (err) {
    console.error('[DevFill] Auto-pull failed:', err.message);
    await DevFillPresetStore.setSyncConfig({
      lastSyncStatus: 'error',
      lastSyncError: err.message || 'Auto-pull failed.'
    });
  }
}

// ---- Auto-push on change ---------------------------------------------------
//
// presetStore.js broadcasts `devfill-presets-changed` after any local
// create/edit/delete/import. Debounced 3s so rapid edits batch into one
// push. Note: MV3 service workers can be terminated while idle, and a
// pending setTimeout does not survive that - if the worker is killed
// mid-debounce, the edit stays local (status "pending") until the next
// mutation, browser restart, or a manual "Push Now".
let pushTimer = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.action === 'devfill-presets-changed') {
    scheduleAutoPush();
  }
});

function scheduleAutoPush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(runAutoPush, 3000);
}

async function runAutoPush() {
  pushTimer = null;
  const config = await DevFillPresetStore.getSyncConfig();
  if (!config.autoPushOnChange || !config.githubPat || !config.gistId) return;

  try {
    const store = await DevFillPresetStore.getStore();
    const result = await DevFillGistSync.updateGist(config.githubPat, config.gistId, store.presets);
    // Adopt the pushed schema's updatedAt locally so future comparisons agree.
    await DevFillPresetStore.setStore(result.schema, { silent: true });
    await DevFillPresetStore.setSyncConfig({
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

// ---- Keyboard shortcut ------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-last-preset') return;

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
