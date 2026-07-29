# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DevFill is a Manifest V3 Chrome/Brave extension that fills web forms with preset or random test data. Vanilla JS, no build step, no dependencies, no bundler, no test suite — every `.js` file is loaded as-is by the manifest or via `importScripts`/`<script>` tags. There is no `package.json`.

## Development workflow

There is no build/lint/test command. To try changes:

1. Open `chrome://extensions` (or `brave://extensions`), enable **Developer mode**, click **Load unpacked**, select the repo folder.
2. After editing, click the reload icon on the extension card. If you edited `content.js`/`lib/faker.js`, also reload any already-open tab you're testing on (content scripts don't hot-reload into existing pages).
3. `background.js` runs as an MV3 service worker — inspect it via the "service worker" link on the extension card in `chrome://extensions`, not a normal page console.
4. `node --check <file>.js` is a reasonable quick syntax sanity check before reloading, since there's no test suite to catch mistakes otherwise.

## Architecture

### Module loading (no bundler — order matters)

- `lib/faker.js` and `content.js` are loaded together as content scripts (see `manifest.json`'s `content_scripts`), in that order. `content.js` accesses the faker via the global `window.DevFillFaker`.
- `background.js` (the service worker) pulls in `lib/presetStore.js` and `lib/gistSync.js` via `importScripts()`, exposed as `self.DevFillPresetStore` / `self.DevFillGistSync`.
- `options.html` and `popup.html` each `<script>`-tag `lib/presetStore.js` (and `options.html` also loads `lib/gistSync.js`) followed by their own page script.
- Every `lib/*.js` file uses the `(function (root) { ... })(self)` IIFE pattern and attaches its API to `root` as a plain object — there is no module system, so new shared code must follow this same pattern to be reachable from all three contexts (popup, options, background).

### Storage: `lib/presetStore.js` is the single funnel

**All** preset/settings/sync-config reads and writes across the whole extension go through `DevFillPresetStore` — never touch `chrome.storage.*` directly from `background.js`, `options.js`, or `popup.js`. This centralization exists so the auto-push-to-Gist hook (`notifyChanged`) and the storage-backend fallback logic only have to live in one place.

Presets are stored primarily in **sharded `chrome.storage.sync`** keys (free, automatic sync tied to the browser's own sync account), not one big blob — a single combined-JSON key would blow past `chrome.storage.sync`'s 8KB-per-item quota after just a handful of presets:
- `df_sync_index`: `{ version, updatedAt, nextSeq, presets: { [name]: shardId } }`
- `df_sync_shard_<id>`: one key per preset's fields object

`chrome.storage.local`'s `presets` key is a safety-net mirror, written unconditionally on every `setStore()` call regardless of which backend is authoritative, so an edit is never lost even if the sync write fails (quota/rate-limit errors are the only failures Chrome actually surfaces to extensions — there is no API to detect "user isn't signed into browser sync," so that's a real, permanent platform limitation, not a bug to try to fix). On a sync write failure, `presetBackend` flips to `'local'` in `syncConfig` (see `handleSyncWriteFailure`/`classifySyncError`), and if a GitHub Gist is already configured, `background.js` pushes to it immediately instead of waiting on the normal debounce.

A one-time, non-destructive migration (`ensureMigrated()`, called from `background.js` on install/startup) copies existing local-only presets into the sync backend the first time; it's re-triggerable on demand as `migrateToSyncBackend()` (wired to the options page's "Retry Chrome Sync" button).

`getStore()`/`setStore()` always return/accept the same `{ version, updatedAt, presets }` shape no matter which backend is active — this is what lets `lib/gistSync.js`, and all the Gist push/pull/diff logic in `background.js` and `options.js`, stay completely unaware of the sync-backend/sharding details.

### Two independent sync mechanisms — don't conflate them

1. **Browser sync** (`chrome.storage.sync`, described above) — automatic, on by default, no user setup. Status shown via the "storage backend" badge on the options page.
2. **GitHub Gist sync** (`lib/gistSync.js`) — opt-in, manual PAT + Gist ID setup, its own status dot in the options page's "Sync" section. This is the durable fallback for when browser sync isn't available or a preset collection is too large for its quotas.

The popup's single status dot (`popup.js`'s `loadSyncDot`) has to summarize both: it prioritizes browser-sync status as the default "good" signal, and only lets Gist state override it when Gist has something more specific to report (an error, or being the only thing actually working). When changing status-reporting logic, keep this priority order in mind rather than treating "sync" as one undifferentiated concept.

### `background.js`: push/pull state machine

- **Push**: presetStore.js broadcasts a `devfill-presets-changed` message after any create/edit/delete/import; `background.js` schedules it via `chrome.alarms` (not `setTimeout`, since MV3 service workers can be killed and a pending timer would not survive that) with a 30s minimum delay. `flushPendingPushIfDue()` claws back most of that latency by pushing immediately the next time the user does something (popup open, fill, keyboard shortcut).
- **Pull**: `checkRemoteForChanges()` is the one code path for both "check on browser startup" and "check just-in-time before the user acts" — throttled to once per 10s, ETag-conditional (cheap 304 when nothing changed), and only overwrites local presets when the remote `updatedAt` is strictly newer (never clobbers an unpushed local edit — it always flushes any pending push first).

### `content.js`: field detection and filling

Three-stage pipeline, each stage independently extensible:
1. **Classify** — `FIELD_RULES` maps a canonical semantic type (`email`, `firstName`, `city`, ...) to regexes tested against a signature built from the field's name/id/placeholder/autocomplete/aria-label/nearby `<label>` text. **Order matters**: more specific patterns must precede general ones (e.g. `address2` before `address`) since the first match wins.
2. **Resolve a value** — `PRESET_KEY_MAP` maps each semantic type to the preset JSON key(s) that might hold it; falls back to `lib/faker.js` random generators (`randomForType`) when no preset value exists or random mode is on, with a last-resort `contextualRandom()` based on the native `<input type>` for anything unclassified.
3. **Write it in** — `setNativeValue()` goes through the native property setter (not `el.value =`) specifically so React's patched setter still picks up the change once `input`/`change`/`blur` events are dispatched afterward. This is why forms in framework-controlled apps update correctly.

The extension never calls `form.submit()` — it only fills fields and fires events.

### UI plumbing: `chrome.storage.onChanged` across three pages

`popup.js` and `options.js` each listen for storage changes to stay live if another context (background.js, or another device via `chrome.storage.sync`) mutates presets. Since presets are now sharded across multiple sync keys, use `DevFillPresetStore.isPresetStorageChange(changes, area)` to detect a relevant mutation (it knows about both the local mirror key and the `df_sync_index`/`df_sync_shard_*` pattern) rather than checking a specific key name directly — then re-fetch via `getPresets()`/`getStore()` rather than reading `changes.presets.newValue` (that shape only exists for the local-area write, not sync-area deltas).
