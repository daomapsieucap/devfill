<div align="center">

# DevFill

Fill web forms instantly with preset or random test data. Built for developers.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4f46e5?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/JavaScript-Vanilla-f7df1e?style=flat-square)
![No build step](https://img.shields.io/badge/build%20step-none-6b7280?style=flat-square)
![No dependencies](https://img.shields.io/badge/dependencies-none-22c55e?style=flat-square)

</div>

## Install (developer mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this repository's folder.
4. Pin the DevFill icon from the extensions toolbar menu for quick access.

## Usage

- Click the DevFill icon, pick a preset from the dropdown, and click **Fill
  with Preset** - or click **Fill with Random Data** to ignore presets
  entirely and generate fresh fake data for every field.
- Toggle **Highlight filled fields** to briefly outline each field DevFill
  writes to.
- Press **Alt+Shift+F** on any page to instantly re-fill using the last
  preset you used (no need to open the popup). You can remap this shortcut
  at `chrome://extensions/shortcuts`.
- DevFill never submits a form - it only fills fields and fires `input`,
  `change`, and `blur` events so React/Vue/Angular-controlled forms pick up
  the change.

## Managing presets

Click **Manage Presets** in the popup (or open the extension's options
page directly) to:

- Create, rename, edit, or delete presets.
- Edit each preset as a JSON object of key/value pairs, e.g.:

  ```json
  {
    "firstName": "Ada",
    "lastName": "Lovelace",
    "email": "ada@example.com",
    "phone": "(555) 010-1000",
    "company": "Analytical Engines Ltd",
    "city": "London",
    "country": "United Kingdom",
    "message": "Custom test message."
  }
  ```

- **Export JSON** downloads all presets as a single file; **Import JSON**
  merges a file of the same shape (`{ "Preset Name": { ...fields } }`) back
  in, overwriting any existing presets with matching names.

A single empty **Default** preset ships out of the box - fill in its
fields (or add your own presets) from the options page.

### Recognized field keys

DevFill matches form fields to preset keys by inspecting each field's
`name`, `id`, `placeholder`, `autocomplete`, and associated `<label>` text.
Keys it understands out of the box:

`firstName`, `lastName`, `fullName` (or `name`), `email`, `phone`,
`company`, `jobTitle`, `website`, `username`, `password`, `address`,
`address2`, `city`, `state`, `zip`, `country`, `message`, `birthDate`, `age`

Any other key you add to a preset is stored fine but won't be
auto-matched unless you also extend the matching rules (see below).

## Syncing presets across computers and browsers

DevFill can keep your presets in sync across machines - and across
different Chromium browsers (Chrome, Brave, Edge, Arc, etc.) - using a
single GitHub Gist as the source of truth. This works the same everywhere
because it doesn't depend on any browser's built-in account sync: DevFill
talks to `api.github.com` directly with your own token, so Brave (which
doesn't sync extension storage) behaves identically to Chrome.

### 1. Create a GitHub Personal Access Token

1. Go to **[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)**
   (GitHub's fine-grained token page).
2. Give it a name like "DevFill sync", set an expiration you're comfortable
   with, and under **Permissions → Account permissions → Gists**, choose
   **Read and write**. No other permissions/repository access are needed.
3. Generate the token and paste it into the **GitHub Personal Access
   Token** field in DevFill's options page, under **Sync**.

The token is stored only in `chrome.storage.local` on that device - it is
never synced, never logged, and the extension only ever sends it to
`api.github.com` (declared explicitly in `manifest.json`'s
`host_permissions`).

### 2. Connect a Gist

- **Create new gist** - creates a new secret gist (visible only to you)
  seeded with an empty preset structure, and fills in the Gist ID field.
  Use **Push Now** afterward to upload your current local presets to it.
- **Use existing gist & pull** - if you already have a DevFill gist (e.g.
  from another machine), paste its ID and click this to pull its presets
  down immediately.

### 3. How sync works day-to-day

- **Working store:** presets always read/write instantly from
  `chrome.storage.local` on the current device - the Gist is only touched
  on an explicit pull/push (or automatically, per the toggles below).
- **Auto-pull on browser startup** (default on): once per browser launch,
  DevFill fetches the gist and compares its `updatedAt` timestamp to the
  local copy's. If the gist is newer, local presets are silently
  replaced. If local is newer (or they match), nothing happens.
- **Auto-push on change** (default on): any create/edit/delete/import is
  pushed to the gist automatically, debounced by 3 seconds so rapid edits
  batch into a single request. Because Manifest V3 service workers can be
  shut down while idle, a pending auto-push can occasionally be dropped if
  the browser terminates the worker in that 3-second window - the change
  stays saved locally (marked "local changes pending") and will go out on
  the next edit, the next browser startup, or a manual **Push Now**.
- **Manual controls** (options page): **Pull Now** / **Push Now** only act
  when there's actually something newer to pull/push, and always show a
  confirmation (with an added/updated/removed/unchanged diff for pulls)
  before overwriting anything. **Force Pull** / **Force Push** bypass the
  timestamp check entirely, for when you're sure which copy should win.

### Recovering from conflicts

A conflict means the Gist and your local presets both changed since the
last sync (e.g. you edited presets on two machines before either synced).
DevFill never auto-resolves this - it always requires a manual pull or
push in that case:

- Open **options → Sync**. The status dot will read **red** (a sync error)
  or **yellow** (local changes pending) - hover the dot for details.
- Decide which copy should win:
  - To keep the gist's version and discard local edits: **Force Pull**.
  - To keep your local edits and overwrite the gist: **Force Push**.
- If you're not sure, use **Export JSON** first as a backup of your
  current local presets before forcing either direction.

## Extending field matching

All field-detection logic lives in `content.js`:

- `FIELD_RULES` - ordered list of `{ type, patterns }` regexes tested
  against a normalized signature built from the field's attributes and
  label. Add a new rule (or extend an existing pattern) to recognize more
  field names. More specific patterns must come before general ones.
- `PRESET_KEY_MAP` - maps each semantic type to the preset JSON key(s)
  that can supply its value.
- `randomForType` in `content.js` (backed by `lib/faker.js`) - generates a
  random value for a semantic type when no preset value is available, or
  when using "Fill with Random Data".

## File structure

```
manifest.json        Manifest V3 config, permissions, keyboard shortcut
popup.html/js         Popup UI: preset picker, fill buttons, highlight toggle, sync dot
options.html/js       Preset management + Sync section (Gist connect/pull/push)
content.js            Field detection + filling, injected into every page
background.js         Service worker: default seeding, auto-pull/auto-push, shortcut handler
lib/faker.js           Small dependency-free fake data generator
lib/presetStore.js     Preset CRUD over chrome.storage.local + sync config, auto-push hook
lib/gistSync.js        GitHub Gist REST client (create/fetch/update, error handling)
styles.css             Shared styling for popup + options page
```

## Known limitations

- Fields inside cross-origin `<iframe>`s are not reachable (browser
  security restriction) - only the top-level page's fields are filled.
- Custom widgets that don't use real `<input>`/`<select>`/`contenteditable`
  elements (e.g. some date pickers rendered entirely in `<div>`s/canvas)
  won't be detected.
