import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPageReferences,
  dataCitationsOf,
  proseCitationsOf,
  referenceDetails,
} from './citations.ts';
import { citeTree, formatNumbers } from '../../integrations/rehype-citations.ts';
import type { ReferenceEntry } from '../../schemas/reference.ts';

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

/** Every citation marker in a tree, as it will render. */
const markers = (node: Node): string[] => {
  const found: string[] = [];
  const walk = (n: Node) => {
    if (n.tagName === 'a' && n.properties?.['data-citation']) {
      found.push((n.children ?? []).map((c) => c.value ?? '').join(''));
    }
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return found;
};

const BIB: ReferenceEntry[] = [
  {
    key: 'wikipedia-toyota-86',
    type: 'wikipedia',
    title: 'Toyota 86',
    publisher: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Toyota_86',
    revision: '1367892282',
    accessed: '2026-08-17',
    license: 'CC BY-SA 4.0',
  },
  {
    key: 'wikipedia-drag-coefficients',
    type: 'wikipedia',
    title: 'List of automobile drag coefficients',
    publisher: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/List',
    revision: '1',
    accessed: '2026-08-17',
    license: 'CC BY-SA 4.0',
  },
  {
    key: 'book-source',
    type: 'book',
    title: 'A Book',
    author: 'Someone',
    year: 1998,
  },
] as ReferenceEntry[];

// ---------------------------------------------------------------------------

describe('citation number formatting', () => {
  it('renders a single number', () => {
    assert.equal(formatNumbers([3]), '[3]');
  });

  it('renders two numbers as a pair, not a range', () => {
    // "[3, 4]" is no longer than "[3–4]" and reads better.
    assert.equal(formatNumbers([3, 4]), '[3, 4]');
  });

  it('collapses three or more consecutive numbers into a range', () => {
    assert.equal(formatNumbers([5, 6, 7]), '[5–7]');
    assert.equal(formatNumbers([1, 3, 4, 5, 9]), '[1, 3–5, 9]');
  });

  it('sorts and de-duplicates', () => {
    assert.equal(formatNumbers([4, 1, 4, 2, 3]), '[1–4]');
  });
});

describe('citing prose', () => {
  it('numbers citations in the order they appear', () => {
    const tree = el(
      'div',
      el('p', text('First [@alpha] then [@beta] then [@alpha] again.')),
    );
    const cited = citeTree(tree);
    assert.deepEqual(markers(tree), ['[1]', '[2]', '[1]']);
    assert.deepEqual(cited, [
      { key: 'alpha', number: 1 },
      { key: 'beta', number: 2 },
    ]);
  });

  it('handles several keys in one token', () => {
    const tree = el('div', el('p', text('Both [@alpha; @beta] agree.')));
    citeTree(tree);
    assert.deepEqual(markers(tree), ['[1, 2]']);
  });

  it('links to the lowest number in a group', () => {
    const tree = el('div', el('p', text('[@a; @b; @c]')));
    citeTree(tree);
    const anchor = tree.children![0]!.children![0]!.children![0]!;
    assert.equal(anchor.properties!.href, '#ref-1');
  });

  it('keeps the surrounding prose intact', () => {
    const tree = el('div', el('p', text('Before [@alpha] after.')));
    citeTree(tree);
    const rendered = (tree.children![0]!.children ?? [])
      .map((n) => (n.type === 'text' ? n.value : markers(n)[0]))
      .join('');
    assert.equal(rendered, 'Before [1] after.');
  });

  it('leaves code and existing links alone', () => {
    const tree = el('div', el('code', text('[@alpha]')), el('a', text('[@beta]')));
    assert.deepEqual(citeTree(tree), []);
    assert.deepEqual(markers(tree), []);
  });

  it('ignores an ordinary bracketed aside', () => {
    const tree = el('div', el('p', text('A number in brackets [3] and a list [a, b].')));
    assert.deepEqual(citeTree(tree), []);
  });

  it('reports a key the bibliography does not define', () => {
    const unknown: string[] = [];
    const tree = el('div', el('p', text('[@nope]')));
    citeTree(tree, { known: new Set(['alpha']), onUnknown: (key) => unknown.push(key) });
    assert.deepEqual(unknown, ['nope']);
  });
});

describe('citations carried by the data', () => {
  it('finds every source key in a nested value tree, in order', () => {
    const data = {
      dimensions: { length: { value: 1, source: 'a' }, width: { value: 2, source: 'b' } },
      trims: [{ power: { value: 3, source: 'a' } }, { mass: { value: 4, source: 'c' } }],
    };
    assert.deepEqual(dataCitationsOf(data), ['a', 'b', 'c']);
  });

  it('finds nothing in a tree with no sources', () => {
    assert.deepEqual(dataCitationsOf({ name: 'x', trims: [] }), []);
    assert.deepEqual(dataCitationsOf(null), []);
  });
});

describe('reading what the plugin recorded', () => {
  it('accepts a well-formed record', () => {
    assert.deepEqual(proseCitationsOf({ citations: [{ key: 'a', number: 1 }] }), [
      { key: 'a', number: 1 },
    ]);
  });

  it('is unbothered by a page with no citations at all', () => {
    assert.deepEqual(proseCitationsOf(undefined), []);
    assert.deepEqual(proseCitationsOf({}), []);
    assert.deepEqual(proseCitationsOf({ citations: 'nonsense' }), []);
    assert.deepEqual(proseCitationsOf({ citations: [{ key: 1 }] }), []);
  });
});

describe('a page reference list', () => {
  it('numbers prose first, then the data, continuing the sequence', () => {
    const { list, numbers } = buildPageReferences(
      [{ key: 'wikipedia-toyota-86', number: 1 }],
      ['wikipedia-drag-coefficients', 'book-source'],
      BIB,
    );
    assert.deepEqual(
      list.map((r) => [r.number, r.entry.key, r.fromDataOnly]),
      [
        [1, 'wikipedia-toyota-86', false],
        [2, 'wikipedia-drag-coefficients', true],
        [3, 'book-source', true],
      ],
    );
    assert.equal(numbers.get('book-source'), 3);
  });

  it('lists a source cited twice exactly once', () => {
    const { list } = buildPageReferences(
      [{ key: 'wikipedia-toyota-86', number: 1 }],
      ['wikipedia-toyota-86', 'book-source'],
      BIB,
    );
    assert.equal(list.length, 2);
    assert.equal(list[0]!.fromDataOnly, false, 'a prose citation keeps its prose number');
  });

  it('drops a key the bibliography cannot resolve rather than inventing a row', () => {
    const { list } = buildPageReferences([], ['nope'], BIB);
    assert.deepEqual(list, []);
  });

  it('is empty for a page that cites nothing', () => {
    assert.deepEqual(buildPageReferences([], [], BIB).list, []);
  });
});

describe('reference details', () => {
  it('never repeats the title, which is rendered as the link', () => {
    const details = referenceDetails(BIB[0]!);
    assert.ok(!details.includes('Toyota 86'), details);
  });

  it('always carries the revision a Wikipedia claim was read at', () => {
    assert.ok(referenceDetails(BIB[0]!).includes('revision 1367892282'));
    assert.ok(referenceDetails(BIB[0]!).includes('read 2026-08-17'));
  });

  it('carries author and year for a book', () => {
    assert.equal(referenceDetails(BIB[2]!), 'Someone · 1998');
  });
});
