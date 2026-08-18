import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildTargets,
  crosslinkTree,
  entryIdFromPath,
  findStandalone,
  type CrosslinkTarget,
} from './rehype-crosslink.ts';

const CONTENT_ROOT = fileURLToPath(new URL('../content', import.meta.url));

interface Node {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

const text = (value: string): Node => ({ type: 'text', value });
const el = (tagName: string, ...children: Node[]): Node => ({
  type: 'element',
  tagName,
  properties: {},
  children,
});

/**
 * A fixed vocabulary, in the order `buildTargets` would produce.
 *
 * Fixed rather than read from `src/content`, so the linking rules are tested
 * against a known set instead of against whatever the catalogue happens to hold
 * this week. `buildTargets` has its own tests against the real content below.
 */
const TARGETS: CrosslinkTarget[] = [
  { id: 'toyota-86-zn6', name: 'Toyota 86 (ZN6)', url: '/Markey/cars/toyota-86-zn6/' },
  { id: 'toyota-86', name: 'Toyota 86', url: '/Markey/cars/toyota-86/' },
  { id: 'toyota', name: 'Toyota', url: '/Markey/brands/toyota/' },
  { id: 'bmw-6-series-e24', name: 'E24', url: '/Markey/cars/bmw-6-series-e24/' },
];

/** The real transformer, over the fixed vocabulary. */
const run = (tree: Node, filePath: string) =>
  crosslinkTree(tree, TARGETS, entryIdFromPath(filePath));

const links = (node: Node): { href: string; text: string }[] => {
  const found: { href: string; text: string }[] = [];
  const walk = (n: Node) => {
    if (n.tagName === 'a' && n.properties?.['data-crosslink']) {
      found.push({
        href: String(n.properties.href),
        text: (n.children ?? []).map((c) => c.value ?? '').join(''),
      });
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return found;
};

// ---------------------------------------------------------------------------

describe('standalone matching', () => {
  it('finds a name surrounded by punctuation or space', () => {
    assert.equal(findStandalone('the Toyota 86 is', 'Toyota 86'), 4);
    assert.equal(findStandalone('Toyota 86, GT86', 'Toyota 86'), 0);
    assert.equal(findStandalone('(Toyota)', 'Toyota'), 1);
  });

  it('refuses a match inside a longer word', () => {
    assert.equal(findStandalone('Toyotas everywhere', 'Toyota'), -1);
    assert.equal(findStandalone('xE24x', 'E24'), -1);
    assert.equal(findStandalone('the E241 code', 'E24'), -1);
  });

  it('is case-sensitive, because lowercase is usually a coincidence', () => {
    assert.equal(findStandalone('a toyota of a car', 'Toyota'), -1);
  });

  it('skips a false match and keeps looking', () => {
    assert.equal(findStandalone('Toyotas, then Toyota', 'Toyota'), 14);
  });

  it('matches a name that ends in punctuation', () => {
    assert.equal(findStandalone('the Toyota 86 (ZN6) is', 'Toyota 86 (ZN6)'), 4);
  });
});

describe('entry id from a source path', () => {
  it('reads the slug out of a content path', () => {
    assert.equal(entryIdFromPath('/x/src/content/cars/toyota-86-zn6.mdx'), 'toyota-86-zn6');
    assert.equal(entryIdFromPath('C:\\x\\src\\content\\brands\\bmw.mdx'), 'bmw');
  });

  it('returns null for anything else', () => {
    assert.equal(entryIdFromPath(undefined), null);
    assert.equal(entryIdFromPath('/x/src/pages/about.astro'), null);
  });
});

describe('the target index', () => {
  const targets = buildTargets(CONTENT_ROOT, '/Markey');

  it('includes every car, brand and generation code', () => {
    const byName = new Map(targets.map((t) => [t.name, t]));
    assert.equal(byName.get('Toyota 86 (ZN6)')?.url, '/Markey/cars/toyota-86-zn6/');
    assert.equal(byName.get('Toyota 86')?.url, '/Markey/cars/toyota-86/');
    assert.equal(byName.get('Toyota')?.url, '/Markey/brands/toyota/');
    assert.equal(byName.get('E24')?.url, '/Markey/cars/bmw-6-series-e24/');
    assert.equal(byName.get('BMW')?.url, '/Markey/brands/bmw/');
  });

  it('carries the base path on every URL', () => {
    for (const target of targets) {
      assert.ok(target.url.startsWith('/Markey/'), `${target.name} → ${target.url}`);
      assert.ok(target.url.endsWith('/'), `${target.name} → ${target.url}`);
    }
  });

  it('sorts longest name first, so the specific entry wins', () => {
    const names = targets.map((t) => t.name);
    const specific = names.indexOf('Toyota 86 (ZN6)');
    const general = names.indexOf('Toyota 86');
    const brand = names.indexOf('Toyota');
    assert.ok(specific < general && general < brand, names.join(' | '));
  });

  it('returns nothing rather than throwing when there is no content', () => {
    assert.deepEqual(buildTargets('/nowhere/at/all', '/Markey'), []);
  });
});

describe('linking prose', () => {
  it('links the first mention of another entry', () => {
    const tree = el('div', el('p', text('Sold as the Toyota 86 in most markets.')));
    run(tree, '/src/content/cars/bmw-6-series-e24.mdx');
    assert.deepEqual(links(tree), [{ href: '/Markey/cars/toyota-86/', text: 'Toyota 86' }]);
  });

  it('links each target once and no more', () => {
    const tree = el(
      'div',
      el('p', text('Toyota built it. Toyota sold it. Toyota still owns the name.')),
    );
    run(tree, '/src/content/cars/bmw-6-series-e24.mdx');
    assert.equal(links(tree).length, 1);
  });

  it('never links a page to itself', () => {
    const tree = el('div', el('p', text('The Toyota 86 (ZN6) is the first generation.')));
    run(tree, '/src/content/cars/toyota-86-zn6.mdx');
    // The specific entry is itself; the hub and the brand are still fair game,
    // but the exact self-name must not become a link.
    assert.ok(!links(tree).some((l) => l.href.includes('toyota-86-zn6')));
  });

  it('prefers the most specific name over a prefix of it', () => {
    const tree = el('div', el('p', text('The Toyota 86 (ZN6) arrived in 2012.')));
    run(tree, '/src/content/brands/bmw.mdx');
    assert.deepEqual(links(tree), [
      { href: '/Markey/cars/toyota-86-zn6/', text: 'Toyota 86 (ZN6)' },
    ]);
  });

  it('leaves the inside of an existing link alone', () => {
    const anchor = el('a', text('Toyota 86'));
    anchor.properties = { href: '/somewhere/' };
    const tree = el('div', el('p', anchor));
    run(tree, '/src/content/brands/bmw.mdx');
    assert.deepEqual(links(tree), []);
  });

  it('leaves code and headings alone', () => {
    const tree = el('div', el('h2', text('Toyota 86')), el('code', text('Toyota 86')));
    run(tree, '/src/content/brands/bmw.mdx');
    assert.deepEqual(links(tree), []);
  });

  it('keeps the surrounding text intact', () => {
    const tree = el('div', el('p', text('Before Toyota 86 after.')));
    run(tree, '/src/content/brands/bmw.mdx');
    const paragraph = tree.children![0]!;
    const rendered = (paragraph.children ?? [])
      .map((n) => (n.type === 'text' ? n.value : (n.children ?? []).map((c) => c.value).join('')))
      .join('');
    assert.equal(rendered, 'Before Toyota 86 after.');
  });

  it('does nothing to prose that names nothing', () => {
    const tree = el('div', el('p', text('A shark-nosed grand tourer.')));
    run(tree, '/src/content/cars/bmw-6-series-e24.mdx');
    assert.deepEqual(links(tree), []);
  });
});
