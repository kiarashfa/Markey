/**
 * Every case here is a real string taken from one of the five articles the
 * Phase 10 pilot batch was authored from. A parser for this job is only worth
 * having if it survives the actual infoboxes, not tidy invented ones.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fieldValues,
  GLOSSARY,
  infoboxes,
  infoboxFields,
  extractConvert,
  parseConvert,
  parseLocalisedNumber,
  plain,
  readField,
  splitTopLevel,
  stripRefs,
  toSi,
  vehicleInfobox,
} from './wikitext.mjs';

describe('splitTopLevel', () => {
  it('ignores pipes nested inside a template', () => {
    assert.deepEqual(
      splitTopLevel('a|{{convert|1|-|2|kg}}|b').map((s) => s.trim()),
      ['a', '{{convert|1|-|2|kg}}', 'b'],
    );
  });

  it('ignores pipes inside a wiki link', () => {
    assert.deepEqual(
      splitTopLevel('x|[[Toyota, Aichi|Toyota]]|y').map((s) => s.trim()),
      ['x', '[[Toyota, Aichi|Toyota]]', 'y'],
    );
  });
});

describe('stripRefs', () => {
  it('removes paired, self-closing and named refs', () => {
    assert.equal(stripRefs('1317 kg<ref name="a">junk</ref>').trim(), '1317 kg');
    assert.equal(stripRefs('50 PS<ref name="oswald-v3"/>').trim(), '50 PS');
  });
});

describe('parseConvert', () => {
  it('reads a plain convert', () => {
    assert.deepEqual(parseConvert('{{convert|2700|mm|1|abbr=on}}'), {
      values: [2700],
      unit: 'mm',
      target: null,
    });
  });

  it('reads the cvt alias and keeps the SOURCE unit, not the rendered one', () => {
    // {{cvt|110|PS|kW|0}} means the publisher wrote 110 PS.
    assert.deepEqual(parseConvert('{{cvt|110|PS|kW|0}}'), {
      values: [110],
      unit: 'PS',
      target: 'kW',
    });
  });

  it('reads an imperial source unit — the Range Rover case', () => {
    assert.deepEqual(parseConvert('{{convert|100.0|in|mm|0|abbr=on}}'), {
      values: [100],
      unit: 'in',
      target: 'mm',
    });
  });

  it('reads a range — the BMW E24 kerb weight case', () => {
    assert.deepEqual(parseConvert('{{convert|1450|-|1619|kg}}'), {
      values: [1450, 1619],
      unit: 'kg',
      target: null,
    });
  });

  it('reads an en-dash range with a target unit', () => {
    assert.deepEqual(parseConvert('{{cvt|790|–|970|kg|lb|1}}'), {
      values: [790, 970],
      unit: 'kg',
      target: 'lb',
    });
  });

  it('strips thousands separators', () => {
    assert.deepEqual(parseConvert('{{cvt|3,891|lb}}')?.values, [3891]);
  });

  it('returns null for something that is not a convert', () => {
    assert.equal(parseConvert('{{ubl|a|b}}'), null);
  });
});

describe('extractConvert', () => {
  it('finds a convert wrapped in surrounding text and keeps the qualifier', () => {
    const result = extractConvert('Cabrio: {{cvt|1412|mm|in|1}},');
    assert.deepEqual(result?.values, [1412]);
    assert.equal(result?.unit, 'mm');
    // Trailing punctuation is trimmed: the useful part is the word.
    assert.equal(result?.qualifier, 'Cabrio');
  });

  it('reports no qualifier when the value stands alone', () => {
    assert.equal(extractConvert('{{cvt|2400|mm|in|1}}')?.qualifier, null);
  });

  it('returns null when there is no convert to find', () => {
    assert.equal(extractConvert('1-speed planetary gear'), null);
  });
});

describe('fieldValues', () => {
  it('splits a {{ubl}} list and drops named parameters', () => {
    assert.deepEqual(fieldValues('{{ubl |Volkswagen Rabbit |Volkswagen Caribe |Citi Golf}}'), [
      'Volkswagen Rabbit',
      'Volkswagen Caribe',
      'Citi Golf',
    ]);
  });

  it('splits an {{unbulleted list}}', () => {
    assert.deepEqual(fieldValues('{{unbulleted list\n | 2003–2012 (Japan)\n | 2005–2009 (China)\n }}'), [
      '2003–2012 (Japan)',
      '2005–2009 (China)',
    ]);
  });

  it('splits <br />-separated values — the Golf length case', () => {
    const raw = '{{cvt|3705|mm|in|1}},<br />later {{cvt|3815|mm|in|1}},<br />USA {{cvt|155.3|in|mm|0}}';
    const parts = fieldValues(raw);
    assert.equal(parts.length, 3);
    assert.match(parts[0], /3705/);
    assert.match(parts[2], /155\.3/);
  });

  it('returns a single value unchanged', () => {
    assert.deepEqual(fieldValues('{{convert|2400|mm|in|1}}'), ['{{convert|2400|mm|in|1}}']);
  });
});

describe('infoboxes / vehicleInfobox', () => {
  const page = [
    '{{Infobox automobile',
    '| name = Toyota Prius (XW20)',
    '| wheelbase = {{convert|2700|mm|1|abbr=on}}',
    '| weight = {{convert|1317|kg|abbr=on}}',
    '}}',
    'Body text.',
    '{{Infobox NCAP',
    '| seat_belt_reminders = 2/3',
    '}}',
  ].join('\n');

  it('finds every infobox on the page', () => {
    assert.equal(infoboxes(page).length, 2);
  });

  it('picks the vehicle one, not the crash-rating one', () => {
    const box = vehicleInfobox(page);
    assert.match(box ?? '', /Infobox automobile/);
  });

  it('picks {{Infobox electric vehicle}} too — the Model 3 case', () => {
    const ev = '{{Infobox electric vehicle\n| name = Tesla Model 3\n| battery = 64 kWh\n}}';
    assert.match(vehicleInfobox(ev) ?? '', /electric vehicle/);
  });

  it('parses fields, lower-casing keys', () => {
    const fields = infoboxFields(vehicleInfobox(page));
    assert.equal(fields.name, 'Toyota Prius (XW20)');
    assert.equal(fields.wheelbase, '{{convert|2700|mm|1|abbr=on}}');
  });
});

describe('readField', () => {
  it('returns one structured entry per published value', () => {
    const fields = {
      length: '{{cvt|3705|mm|in|1}},<br />later {{cvt|3815|mm|in|1}}',
    };
    const entries = readField(fields, 'length');
    assert.equal(entries.length, 2);
    assert.deepEqual(entries[0].values, [3705]);
    assert.equal(entries[0].unit, 'mm');
    // The second value is qualified 'later' — which car it describes matters.
    assert.equal(entries[1].qualifier, 'later');
  });

  it('is empty for a field the infobox does not have', () => {
    assert.deepEqual(readField({}, 'weight'), []);
  });
});

describe('plain', () => {
  it('unwraps links and strips markup', () => {
    assert.equal(plain("[[Giorgetto Giugiaro]] at '''[[Italdesign]]'''"), 'Giorgetto Giugiaro at Italdesign');
  });

  it('drops sfnp and efn noise', () => {
    assert.equal(plain('602 cc air-cooled H2{{sfnp|Willson|1995|p=69}}'), '602 cc air-cooled H2');
  });
});

describe('toSi', () => {
  it('converts PS to kW and reports the factor for the sourceNote', () => {
    const result = toSi(110, 'PS');
    assert.equal(result?.unit, 'kW');
    assert.ok(Math.abs((result?.value ?? 0) - 80.9) < 0.05);
    assert.match(result?.note ?? '', /1 PS = 0.73549875 kW/);
  });

  it('converts pounds to kilograms — the Tesla case', () => {
    assert.ok(Math.abs((toSi(3891, 'lb')?.value ?? 0) - 1764.9) < 0.5);
  });

  it('adds no note when the unit is already SI', () => {
    assert.equal(toSi(1317, 'kg')?.note, null);
  });

  it('returns null for a unit it does not know, rather than guessing', () => {
    assert.equal(toSi(1, 'furlong'), null);
  });
});

describe('parseLocalisedNumber — the 1000x trap', () => {
  it('reads a German number with both separators', () => {
    const r = parseLocalisedNumber('1.234,5', 'de');
    assert.equal(r?.value, 1234.5);
    assert.equal(r?.ambiguous, false);
  });

  it('reads an English number with both separators', () => {
    assert.equal(parseLocalisedNumber('1,234.5', 'en')?.value, 1234.5);
  });

  it('reads a plain integer unchanged', () => {
    assert.equal(parseLocalisedNumber('1190', 'de')?.value, 1190);
  });

  it('reads a German decimal comma', () => {
    assert.equal(parseLocalisedNumber('0,45', 'de')?.value, 0.45);
  });

  it('FLAGS the genuinely ambiguous case rather than guessing silently', () => {
    // "1.200" is 1200 kg in German and 1.2 in English. A validator cannot tell.
    const r = parseLocalisedNumber('1.200', 'de');
    assert.equal(r?.value, 1200);
    assert.equal(r?.ambiguous, true);
    assert.match(r?.note ?? '', /ambiguous/);
  });

  it('reads the same ambiguous string the English way for an English source', () => {
    const r = parseLocalisedNumber('1.200', 'en');
    assert.equal(r?.value, 1.2);
    assert.equal(r?.ambiguous, true);
  });

  it('handles repeated grouping separators', () => {
    assert.equal(parseLocalisedNumber('1.234.567', 'de')?.value, 1234567);
  });

  it('returns null for something that is not a number', () => {
    assert.equal(parseLocalisedNumber('Leergewicht', 'de'), null);
    assert.equal(parseLocalisedNumber('', 'de'), null);
  });
});

describe('GLOSSARY', () => {
  it('warns that Gesamtgewicht is not kerb weight', () => {
    assert.match(GLOSSARY.de['zulässiges Gesamtgewicht'], /NOT kerb/);
    assert.match(GLOSSARY.de.Leergewicht, /kerb weight/);
  });

  it('covers every sourcing language the plan uses', () => {
    for (const lang of ['de', 'fr', 'it', 'nl', 'ru', 'ja']) {
      assert.ok(Object.keys(GLOSSARY[lang]).length > 0, `${lang} has no glossary`);
    }
  });
});
