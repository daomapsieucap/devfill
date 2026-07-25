/**
 * DevFill content script.
 *
 * Responsible for:
 *  1. Detecting form fields on the page and classifying them into a
 *     canonical "semantic type" (email, firstName, city, ...).
 *  2. Resolving a value for that semantic type, either from the active
 *     preset or from the random generator (lib/faker.js).
 *  3. Writing the value into the DOM in a way that framework-driven forms
 *     (React/Vue/Angular) actually notice.
 */
(function () {
  'use strict';

  // -------------------------------------------------------------------
  // 1. Field classification
  // -------------------------------------------------------------------
  //
  // Each entry maps a canonical "semantic type" to a list of regexes that
  // are tested against a normalized signature string built from the
  // field's name/id/placeholder/autocomplete/aria-label/label text.
  //
  // ORDER MATTERS: more specific patterns must come before more general
  // ones (e.g. "address2" before "address", "firstName" before "fullName")
  // because the first match wins. To teach DevFill about a new field,
  // add a new entry here (or extend an existing pattern list).
  const FIELD_RULES = [
    { type: 'email', patterns: [/e[-_ ]?mail/] },
    { type: 'password', patterns: [/pass(word)?|pwd/] },
    { type: 'confirmPassword', patterns: [/confirm.*pass|re[-_]?enter.*pass|password.*confirm/] },
    { type: 'username', patterns: [/user[-_ ]?name|\buser[-_]?id\b|\blogin\b/] },
    { type: 'phone', patterns: [/phone|mobile|\bcell\b|\btel\b/] },
    { type: 'address2', patterns: [/address[-_ ]?(line)?[-_ ]?2|apt|suite|unit\b/] },
    { type: 'address', patterns: [/address|street/] },
    { type: 'city', patterns: [/\bcity\b|\btown\b/] },
    { type: 'state', patterns: [/\bstate\b|\bprovince\b|\bregion\b/] },
    { type: 'zip', patterns: [/\bzip\b|postal|postcode/] },
    { type: 'country', patterns: [/\bcountry\b/] },
    { type: 'company', patterns: [/company|organization|\borg\b|business[-_ ]?name/] },
    { type: 'jobTitle', patterns: [/job[-_ ]?title|position|\brole\b|occupation/] },
    { type: 'website', patterns: [/website|homepage|\burl\b/] },
    { type: 'birthDate', patterns: [/birth|\bdob\b/] },
    { type: 'age', patterns: [/\bage\b/] },
    { type: 'creditCard', patterns: [/card[-_ ]?number|cc[-_ ]?number|credit[-_ ]?card/] },
    { type: 'message', patterns: [/message|comment|feedback|description|\bnotes?\b|\bbio\b/] },
    { type: 'firstName', patterns: [/first[-_ ]?name|given[-_ ]?name|\bfname\b/] },
    { type: 'lastName', patterns: [/last[-_ ]?name|family[-_ ]?name|surname|\blname\b/] },
    { type: 'fullName', patterns: [/full[-_ ]?name|^name$|your[-_ ]?name|contact[-_ ]?name|\bname\b/] }
  ];

  // Fallbacks based purely on the input's `type` attribute, used when no
  // name/label pattern above matched.
  const INPUT_TYPE_FALLBACK = {
    email: 'email',
    tel: 'phone',
    url: 'website',
    password: 'password'
  };

  function normalize(str) {
    return (str || '').toLowerCase();
  }

  // Collects every scrap of text/attribute info that might hint at a
  // field's purpose into one lowercase "signature" string.
  function buildSignature(el) {
    const parts = [
      el.name, el.id, el.placeholder, el.getAttribute('autocomplete'),
      el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.className
    ];

    // <label for="id">
    if (el.id) {
      const labelFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelFor) parts.push(labelFor.textContent);
    }
    // <label><input>...</label>
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) parts.push(wrappingLabel.textContent);

    // Nearby preceding text (common in hand-rolled forms without <label>)
    const prev = el.previousElementSibling;
    if (prev && /^(label|span|div|p)$/i.test(prev.tagName) && prev.textContent.trim().length < 60) {
      parts.push(prev.textContent);
    }

    return normalize(parts.filter(Boolean).join(' '));
  }

  function detectFieldType(el) {
    const signature = buildSignature(el);
    for (const rule of FIELD_RULES) {
      if (rule.patterns.some((re) => re.test(signature))) return rule.type;
    }
    const typeAttr = (el.getAttribute('type') || '').toLowerCase();
    if (INPUT_TYPE_FALLBACK[typeAttr]) return INPUT_TYPE_FALLBACK[typeAttr];
    return null; // unknown - handled contextually by generateRandomForType
  }

  // -------------------------------------------------------------------
  // 2. Value resolution
  // -------------------------------------------------------------------

  // Maps a semantic type to the preset JSON key(s) that may hold it,
  // in priority order.
  const PRESET_KEY_MAP = {
    fullName: ['fullName', 'name'],
    firstName: ['firstName', 'first_name', 'fname'],
    lastName: ['lastName', 'last_name', 'lname'],
    email: ['email'],
    phone: ['phone', 'telephone'],
    company: ['company', 'organization'],
    jobTitle: ['jobTitle', 'title', 'position'],
    website: ['website', 'url'],
    username: ['username'],
    password: ['password'],
    address: ['address', 'address1', 'street'],
    address2: ['address2'],
    city: ['city'],
    state: ['state', 'province'],
    zip: ['zip', 'postalCode'],
    country: ['country'],
    message: ['message', 'comments', 'bio'],
    birthDate: ['birthDate', 'dob'],
    age: ['age']
  };

  function fromPreset(preset, type) {
    if (!preset) return undefined;
    const keys = PRESET_KEY_MAP[type] || [type];
    for (const key of keys) {
      if (preset[key] !== undefined && preset[key] !== '') return preset[key];
    }
    // Derive firstName/lastName from a combined fullName if that's all we have.
    if (type === 'firstName' && preset.fullName) return preset.fullName.split(' ')[0];
    if (type === 'lastName' && preset.fullName) return preset.fullName.split(' ').slice(1).join(' ') || preset.fullName;
    if (type === 'fullName' && preset.firstName) return `${preset.firstName} ${preset.lastName || ''}`.trim();
    return undefined;
  }

  function randomForType(type, el) {
    const f = window.DevFillFaker;
    switch (type) {
      case 'fullName': return f.fullName();
      case 'firstName': return f.firstName();
      case 'lastName': return f.lastName();
      case 'email': return f.email();
      case 'phone': return f.phone();
      case 'company': return f.company();
      case 'jobTitle': return f.jobTitle();
      case 'website': return f.website();
      case 'username': return f.username();
      case 'password':
      case 'confirmPassword': return f.password();
      case 'address': return f.streetAddress();
      case 'address2': return f.addressLine2();
      case 'city': return f.city();
      case 'state': return f.stateName();
      case 'zip': return f.zip();
      case 'country': return f.country();
      case 'message': return f.paragraph();
      case 'birthDate': return f.birthDate();
      case 'age': return String(f.age());
      case 'creditCard': return f.creditCard();
      default: return contextualRandom(el);
    }
  }

  // Last-resort generator for fields DevFill couldn't classify: falls
  // back to the native input `type`/tag so the form still gets *something*
  // plausible instead of being skipped.
  function contextualRandom(el) {
    const f = window.DevFillFaker;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || 'text').toLowerCase();

    if (tag === 'textarea') return f.sentence();
    if (tag === 'select') return null; // handled separately
    switch (type) {
      case 'number': case 'range': return String(f.number(el.min || 0, el.max || 100));
      case 'date': return f.futureDate();
      case 'datetime-local': return f.datetimeLocal();
      case 'time': return f.time();
      case 'month': return f.month();
      case 'week': return f.week();
      case 'color': return f.color();
      case 'checkbox': case 'radio': return f.boolean();
      default: return f.sentence(3).replace(/\.$/, '');
    }
  }

  function resolveValue(type, el, preset, randomMode) {
    if (!randomMode && type) {
      const presetValue = fromPreset(preset, type);
      if (presetValue !== undefined) return presetValue;
    }
    if (type) return randomForType(type, el);
    return contextualRandom(el);
  }

  // -------------------------------------------------------------------
  // 3. Writing values into the DOM
  // -------------------------------------------------------------------

  // Uses the native property setter so React's synthetic event system
  // (which patches the instance setter) still detects the change when we
  // dispatch an `input` event afterwards.
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function fireEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function highlight(el) {
    const prevOutline = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = '2px solid #6366f1';
    el.style.outlineOffset = '1px';
    setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
    }, 700);
  }

  function fillSelect(el, type, preset, randomMode) {
    const options = Array.from(el.options).filter((o) => o.value !== '');
    if (options.length === 0) return false;

    let target;
    if (type) {
      const desired = resolveValue(type, el, preset, randomMode);
      if (desired !== null && desired !== undefined) {
        const desiredStr = normalize(String(desired));
        target = options.find(
          (o) => normalize(o.value) === desiredStr || normalize(o.textContent).includes(desiredStr)
        );
      }
    }
    if (!target) target = window.DevFillFaker.pick(options);

    el.value = target.value;
    fireEvents(el);
    return true;
  }

  function fillCheckboxOrRadio(el, group) {
    if (el.type === 'radio') {
      // Only one radio per name group should be checked.
      if (group.has(el.name)) return false;
      group.add(el.name);
    }
    el.checked = window.DevFillFaker.boolean();
    fireEvents(el);
    return true;
  }

  function fillContentEditable(el, preset, randomMode) {
    const type = detectFieldType(el) || 'message';
    const value = resolveValue(type, el, preset, randomMode);
    el.textContent = String(value);
    fireEvents(el);
    return true;
  }

  function isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'reset' || el.type === 'file' || el.type === 'image') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  function fillForm(preset, randomMode, highlightEnabled) {
    const radioGroupsSeen = new Set();
    let filledCount = 0;

    const elements = document.querySelectorAll('input, textarea, select, [contenteditable="true"]');
    elements.forEach((el) => {
      if (!isFillable(el)) return;

      let didFill = false;
      if (el.tagName === 'SELECT') {
        const type = detectFieldType(el);
        didFill = fillSelect(el, type, preset, randomMode);
      } else if (el.hasAttribute('contenteditable')) {
        didFill = fillContentEditable(el, preset, randomMode);
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        didFill = fillCheckboxOrRadio(el, radioGroupsSeen);
      } else {
        const type = detectFieldType(el);
        const value = resolveValue(type, el, preset, randomMode);
        if (value === null || value === undefined) return;
        setNativeValue(el, String(value));
        fireEvents(el);
        didFill = true;
      }

      if (didFill) {
        filledCount++;
        if (highlightEnabled) highlight(el);
      }
    });

    return filledCount;
  }

  // -------------------------------------------------------------------
  // Message bridge
  // -------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'devfill-fill') return;
    const count = fillForm(message.preset || {}, !!message.random, !!message.highlight);
    sendResponse({ filledCount: count });
    return true;
  });
})();
