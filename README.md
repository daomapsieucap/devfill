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

Three presets ship by default: **Default User**, **Business Contact**, and
**Edge Cases** (unicode names, symbols, long/short values - useful for
stress-testing validation and layout).

### Recognized field keys

DevFill matches form fields to preset keys by inspecting each field's
`name`, `id`, `placeholder`, `autocomplete`, and associated `<label>` text.
Keys it understands out of the box:

`firstName`, `lastName`, `fullName` (or `name`), `email`, `phone`,
`company`, `jobTitle`, `website`, `username`, `password`, `address`,
`address2`, `city`, `state`, `zip`, `country`, `message`, `birthDate`, `age`

Any other key you add to a preset is stored fine but won't be
auto-matched unless you also extend the matching rules (see below).

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
popup.html/js         Popup UI: preset picker, fill buttons, highlight toggle
options.html/js       Preset management page (create/edit/delete/import/export)
content.js            Field detection + filling, injected into every page
background.js         Service worker: default preset seeding, shortcut handler
lib/faker.js           Small dependency-free fake data generator
styles.css             Shared styling for popup + options page
```

## Known limitations

- Fields inside cross-origin `<iframe>`s are not reachable (browser
  security restriction) - only the top-level page's fields are filled.
- Custom widgets that don't use real `<input>`/`<select>`/`contenteditable`
  elements (e.g. some date pickers rendered entirely in `<div>`s/canvas)
  won't be detected.
