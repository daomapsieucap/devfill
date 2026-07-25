/**
 * DevFill background service worker.
 * - Seeds default presets/settings on first install.
 * - Handles the Alt+Shift+F keyboard shortcut to fill with the last used preset.
 */

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
    email: 'michael.chen@bluepeaksolutions.com',
    phone: '(415) 555-0199',
    company: 'Blue Peak Solutions',
    jobTitle: 'VP of Operations',
    website: 'https://www.bluepeaksolutions.com',
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

const DEFAULT_SETTINGS = {
  lastUsedPreset: 'Default User',
  highlightFields: true
};

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;
  const existing = await chrome.storage.local.get(['presets', 'settings']);
  const toSet = {};
  if (!existing.presets) toSet.presets = DEFAULT_PRESETS;
  if (!existing.settings) toSet.settings = DEFAULT_SETTINGS;
  if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'fill-last-preset') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const { presets = {}, settings = {} } = await chrome.storage.local.get(['presets', 'settings']);
  const presetName = settings.lastUsedPreset;
  const preset = (presetName && presets[presetName]) || {};

  chrome.tabs.sendMessage(tab.id, {
    action: 'devfill-fill',
    preset,
    random: false,
    highlight: settings.highlightFields !== false
  }).catch(() => {
    // No content script on this page (e.g. chrome:// URL) - nothing to do.
  });
});
