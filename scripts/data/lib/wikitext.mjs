/**
 * The wikitext parser Phase 1 called "the minimum viable `scripts/data/`
 * helper" and Phase 10 confirmed by hand-parsing five cars.
 *
 * Pure functions over strings — no I/O, no network — so the awkward cases can
 * be held to tests rather than to an author's memory. Every behaviour here
 * exists because a real infobox in the pilot batch needed it:
 *
 *  - `{{convert|2630|mm|in|1|abbr=on}}` and its alias `{{cvt}}` — Prius, Golf
 *  - `{{convert|1450|-|1619|kg}}` ranges — BMW E24 kerb weight
 *  - `{{cvt|110|PS|kW|0}}` where the *source* unit is second — Golf engines
 *  - `{{convert|100.0|in|mm|0}}` where the source unit is imperial — Range Rover
 *  - `{{ubl}}` / `{{unbulleted list}}` multi-value fields — every car
 *  - `<br />`-separated multi-values — Golf dimensions, Range Rover wheelbase
 *  - `<ref>…</ref>` and `{{efn}}` noise inside otherwise clean values
 *  - `[[Link|display]]` and `''italics'''` markup
 *
 * **What it deliberately does not do is decide anything.** It returns what the
 * infobox says, including ranges and multiple values, and leaves the judgement
 * — which trim, which figure, whether two sources conflict — to the author.
 */

/** Strips `<ref>…</ref>`, self-closing refs and HTML comments. */
export function stripRefs(text) {
  return text
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Splits on a template's top-level `|`, ignoring pipes nested inside `{{}}`,
 * `[[]]` or `<>`. Naive splitting on `|` is the single most common way to
 * mangle an infobox, because `{{convert|1|-|2|kg}}` is full of them.
 */
export function splitTopLevel(body, separator = '|') {
  const parts = [];
  let depth = 0;
  let link = 0;
  let angle = 0;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      if (two === '{{') depth += 1;
      else link += 1;
      current += two;
      i += 1;
      continue;
    }
    if (two === '}}' || two === ']]') {
      if (two === '}}') depth -= 1;
      else link -= 1;
      current += two;
      i += 1;
      continue;
    }
    const ch = body[i];
    if (ch === '<') angle += 1;
    if (ch === '>') angle = Math.max(0, angle - 1);
    if (ch === separator && depth === 0 && link === 0 && angle === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** Finds a balanced `{{…}}` starting at `start`, returning its full text. */
function balancedTemplate(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text.startsWith('{{', i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (text.startsWith('}}', i)) {
      depth -= 1;
      i += 1;
      if (depth === 0) return text.slice(start, i + 1);
      continue;
    }
  }
  return null;
}

/**
 * Extracts every `{{Infobox …}}` in the page, in document order.
 *
 * Plural because a car article routinely carries more than one — the Prius has
 * an NCAP infobox alongside the automobile one — and taking the first match
 * blindly is how an agent ends up reading crash ratings as dimensions.
 */
export function infoboxes(wikitext) {
  const found = [];
  const pattern = /\{\{\s*infobox/gi;
  let match;
  while ((match = pattern.exec(wikitext)) !== null) {
    const template = balancedTemplate(wikitext, match.index);
    if (template) {
      found.push(template);
      pattern.lastIndex = match.index + template.length;
    }
  }
  return found;
}

/**
 * The automobile infobox, whichever template name it uses.
 *
 * Phase 10 found the Model 3 uses `{{Infobox electric vehicle}}` — a different
 * template with `motor`, `battery` and `electric_range` where the petrol one
 * has `engine`. An agent that matches only `Infobox automobile` silently gets
 * nothing for every EV.
 */
export function vehicleInfobox(wikitext) {
  const all = infoboxes(wikitext);
  return (
    all.find((box) => /\{\{\s*infobox\s+(automobile|electric vehicle|car|vehicle)/i.test(box)) ??
    all[0] ??
    null
  );
}

/** Parses an infobox into `{ field: rawValue }`, refs and comments removed. */
export function infoboxFields(infoboxText) {
  if (!infoboxText) return {};
  const inner = infoboxText.replace(/^\{\{/, '').replace(/\}\}$/, '');
  const parts = splitTopLevel(inner);
  /** @type {Record<string, string>} */
  const fields = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = stripRefs(part.slice(eq + 1)).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

/**
 * Unwraps a `{{convert}}` / `{{cvt}}` into the value(s) **as published**.
 *
 * The subtlety that matters: the *first* unit is the source unit, and it is
 * often imperial. `{{convert|100.0|in|mm|0}}` means the publisher wrote
 * 100 inches and Wikipedia rendered the millimetres. Recording 2540 mm is
 * right, but the `sourceNote` must say it was published in inches — which is
 * why this returns the source unit rather than silently normalising.
 *
 * Returns `{ values: number[], unit: string, target: string|null }`, with two
 * values for a range (`{{convert|1450|-|1619|kg}}`).
 */
export function parseConvert(template) {
  const match = /^\{\{\s*(convert|cvt)\s*\|([\s\S]*)\}\}$/i.exec(template.trim());
  if (!match) return null;
  const args = splitTopLevel(match[2]).map((a) => a.trim());
  const positional = args.filter((a) => !a.includes('='));
  if (positional.length === 0) return null;

  const values = [];
  let index = 0;
  const asNumber = (raw) => {
    const cleaned = raw.replace(/,/g, '').replace(/&nbsp;/g, '').trim();
    return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
  };

  const first = asNumber(positional[index]);
  if (first === null) return null;
  values.push(first);
  index += 1;

  // A range separator: `-`, `–`, `to`, `and`, `x`, `×`.
  if (index < positional.length && /^(-|–|to|and|x|×|by)$/i.test(positional[index])) {
    index += 1;
    const second = asNumber(positional[index]);
    if (second !== null) {
      values.push(second);
      index += 1;
    }
  }

  const unit = positional[index] ?? null;
  const target = positional[index + 1] ?? null;
  return { values, unit, target: target && !/^\d+$/.test(target) ? target : null };
}

/**
 * Finds the first `{{convert}}`/`{{cvt}}` embedded anywhere in a string.
 *
 * Infobox values are rarely a bare template. Real ones look like
 * `Saloon: {{cvt|1395|mm|in|1}},` or `later {{cvt|3815|mm|in|1}}` — the
 * template plus a qualifier that says *which* car the figure describes. That
 * qualifier is not noise; it is the difference between a Cabriolet's height
 * and a hatchback's, so it is returned rather than discarded.
 */
export function extractConvert(text) {
  const match = /\{\{\s*(convert|cvt)\s*\|/i.exec(text);
  if (!match) return null;
  const template = balancedTemplate(text, match.index);
  if (!template) return null;
  const parsed = parseConvert(template);
  if (!parsed) return null;
  const qualifier = plain(text.slice(0, match.index) + ' ' + text.slice(match.index + template.length))
    .replace(/^[\s,;:]+|[\s,;:]+$/g, '')
    .trim();
  return { ...parsed, qualifier: qualifier.length > 0 ? qualifier : null };
}

/** Strips wiki markup from a plain string: links, bold/italics, entities. */
export function plain(text) {
  return stripRefs(text)
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\{\{\s*(efn|sfnp|sfn|citation needed|page needed)[^}]*\}\}/gi, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Splits a field into the separate values it actually holds.
 *
 * `{{ubl}}`, `{{unbulleted list}}`, `{{plainlist}}` and bare `<br />` all mean
 * "this field has several values", and every car in the pilot batch used at
 * least one of them. Returns raw strings, each still possibly a `{{convert}}`.
 */
export function fieldValues(raw) {
  if (!raw) return [];
  const listMatch = /^\{\{\s*(ubl|unbulleted list|plainlist|plain list|hlist)\s*\|([\s\S]*)\}\}$/i.exec(
    raw.trim(),
  );
  const body = listMatch ? listMatch[2] : raw;
  const parts = listMatch
    ? splitTopLevel(body).filter((p) => !p.includes('='))
    : splitTopLevel(body, '\n').flatMap((line) => line.split(/<br\s*\/?>/i));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Reads one infobox field into structured values.
 *
 * Each returned item is `{ raw, text, values, unit, target }` — `values`/`unit`
 * populated only where the entry was a `{{convert}}`. A field with three
 * `<br />`-separated dimensions comes back as three items, which is the honest
 * representation: the author picks, the parser does not.
 */
export function readField(fields, name) {
  const raw = fields[name];
  if (!raw) return [];
  return fieldValues(raw).map((entry) => {
    const converted = extractConvert(entry);
    return {
      raw: entry,
      text: plain(entry),
      /** e.g. 'Cabrio:', 'later', 'USA' — which variant the figure describes. */
      qualifier: converted?.qualifier ?? null,
      values: converted?.values ?? null,
      unit: converted?.unit ?? null,
      target: converted?.target ?? null,
    };
  });
}

/** Unit conversions used when a source publishes in something other than SI. */
export const TO_SI = {
  PS: { factor: 0.73549875, unit: 'kW' },
  hp: { factor: 0.745699872, unit: 'kW' },
  bhp: { factor: 0.745699872, unit: 'kW' },
  kW: { factor: 1, unit: 'kW' },
  'hp-metric': { factor: 0.73549875, unit: 'kW' },
  lb: { factor: 0.45359237, unit: 'kg' },
  lbs: { factor: 0.45359237, unit: 'kg' },
  kg: { factor: 1, unit: 'kg' },
  in: { factor: 25.4, unit: 'mm' },
  mm: { factor: 1, unit: 'mm' },
  cm: { factor: 10, unit: 'mm' },
  mph: { factor: 1.609344, unit: 'km/h' },
  kph: { factor: 1, unit: 'km/h' },
  'km/h': { factor: 1, unit: 'km/h' },
  kgm: { factor: 9.80665, unit: 'Nm' },
  lbft: { factor: 1.3558179, unit: 'Nm' },
  Nm: { factor: 1, unit: 'Nm' },
  cc: { factor: 1, unit: 'cc' },
  L: { factor: 1000, unit: 'cc' },
  cuin: { factor: 16.387064, unit: 'cc' },
};

/**
 * Converts a published figure to the SI unit the schema stores, reporting the
 * factor so it can be written into `sourceNote` — which is the project's rule:
 * a converted number states what it was converted from and by what.
 */
export function toSi(value, unit) {
  const rule = TO_SI[unit];
  if (!rule) return null;
  return {
    value: value * rule.factor,
    unit: rule.unit,
    factor: rule.factor,
    note:
      rule.factor === 1
        ? null
        : `Published as ${value} ${unit}, converted at 1 ${unit} = ${rule.factor} ${rule.unit}.`,
  };
}
