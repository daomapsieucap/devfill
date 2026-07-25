<div align="center">

<img src="icons/icon128.png" width="64" height="64" alt="DevFill icon" />

# DevFill

Fill web forms instantly with preset or random test data. Built for developers.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4f46e5?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/JavaScript-Vanilla-f7df1e?style=flat-square)
![No build step](https://img.shields.io/badge/build%20step-none-6b7280?style=flat-square)
![No dependencies](https://img.shields.io/badge/dependencies-none-22c55e?style=flat-square)

</div>

---

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

## Syncing presets across computers and browsers

DevFill can keep your presets in sync across machines and browsers using
a private GitHub Gist as the backup copy. You'll need a GitHub account
and a personal access token.

### 1. Create a GitHub Personal Access Token

1. Go to **[github.com/settings/tokens/new?scopes=gist](https://github.com/settings/tokens/new?scopes=gist)**
   and generate a token (the **gist** scope is pre-checked for you - leave
   everything else as-is). It must be a **classic** token; GitHub's
   fine-grained tokens don't support Gists.
2. Paste the token into the **GitHub Personal Access Token** field in
   DevFill's options page, under **Sync**. It's stored only on this
   device and never leaves it except to talk to GitHub.

### 2. Connect a Gist

- **Create new gist** - makes a new private gist for your presets and
  fills in the Gist ID field. Click **Sync Now** afterward to upload your
  current presets to it.
- **Use existing gist & pull** - already have a DevFill gist from another
  computer? Paste its ID here and click this to pull its presets down.

### 3. Day-to-day

With **"Keep in sync automatically"** turned on (the default), you don't
need to do anything else - DevFill checks for changes whenever you use
it, and uploads your edits shortly after you make them.

If you want to sync immediately instead of waiting, click **Sync Now** -
it figures out whether to pull or push on its own.

### If sync gets stuck (a conflict)

This can happen if you edited presets on two computers before either one
synced. Open **options → Sync** - the status dot turns **red** (an error)
or **yellow** (unsynced local changes) when this happens.

Decide which copy should win, then:
- Keep the gist's version, discard local edits: **Force Pull**.
- Keep your local edits, overwrite the gist: **Force Push**.

Not sure which to pick? Click **Export JSON** first to save a backup of
your current presets before forcing either direction.

## Known limitations

- Fields inside cross-origin `<iframe>`s are not reachable (browser
  security restriction) - only the top-level page's fields are filled.
- Custom widgets that don't use real `<input>`/`<select>`/`contenteditable`
  elements (e.g. some date pickers rendered entirely in `<div>`s/canvas)
  won't be detected.
