/**
 * Numbered citations in prose — SPEC.md §5.5.
 *
 * An author writes `[@wikipedia-toyota-86]` and the page renders `[1]`, linked
 * to a numbered entry in that page's own References section. Several at once —
 * `[@a; @b; @c]` — collapse to `[1–3]` when the numbers run consecutively and
 * `[1, 4]` when they do not, which is the convention every printed reference
 * style uses and the reason ranges are worth the code.
 *
 * ## Why per page rather than one site-wide list
 *
 * Because a bibliography is a property of a document, not of a library. The
 * site already has eight sources with four cars in it; at a thousand cars a
 * single list is thousands of rows, and a reader on one car page would have to
 * search it to find which two entries their page actually rests on. Per-page
 * numbering is what makes a citation checkable in the time a reader will
 * actually spend. `/attributions/` keeps the site-wide licence obligations,
 * which genuinely are site-wide.
 *
 * ## Why rehype and not remark
 *
 * The replacement is an element — `<sup><a>` — and hast is where elements can
 * be built directly. Doing it in remark would mean emitting raw HTML into MDX,
 * where it is parsed as JSX and one stray brace is a build error in someone
 * else's file.
 *
 * ## How the numbers reach the page
 *
 * Through `file.data.astro.frontmatter`, which Astro surfaces as
 * `remarkPluginFrontmatter` from `render()`. The plugin owns the numbering
 * because only it knows the order the citations appear in the prose; the page
 * owns the References list, because only it knows what *else* the page cites —
 * every sourced figure in the spec tables gets a number too, continuing from
 * where the prose left off.
 */
import { readFileSync } from 'node:fs';

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

interface VFileLike {
  path?: string;
  history?: string[];
  data?: {
    astro?: {
      frontmatter?: Record<string, unknown>;
    };
  };
}

export interface ProseCitation {
  key: string;
  number: number;
}

/** Nothing inside these is scanned for citation tokens. */
const SKIP_TAGS = new Set(['a', 'code', 'pre', 'kbd', 'samp', 'script', 'style']);

/**
 * `[@key]` or `[@key; @key2; @key3]`.
 *
 * The `@` is what keeps this from colliding with an ordinary bracketed aside,
 * and the separator is `;` rather than `,` because a citation key may not
 * contain either but prose containing "[a, b]" is common and this must not
 * match it.
 */
const TOKEN = /\[@([a-z0-9-]+(?:\s*;\s*@[a-z0-9-]+)*)\]/g;

const parseKeys = (body: string): string[] =>
  body
    .split(';')
    .map((part) => part.trim().replace(/^@/, ''))
    .filter(Boolean);

/**
 * Renders a set of numbers the way a reference style does.
 *
 * `[1]`, `[1, 4]`, `[2–4]`, `[1, 3–5, 9]`. Three or more consecutive numbers
 * become a range; two do not, because "[3, 4]" is shorter than "[3–4]" and
 * reads better.
 */
export function formatNumbers(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1) end++;
    const run = end - index;
    if (run >= 2) parts.push(`${sorted[index]}–${sorted[end]}`);
    else for (let i = index; i <= end; i++) parts.push(String(sorted[i]));
    index = end + 1;
  }
  return `[${parts.join(', ')}]`;
}

/** The citation keys the bibliography actually defines. */
function knownKeys(referencesPath: string): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(referencesPath, 'utf8')) as {
      entries?: { key?: string }[];
    };
    return new Set((parsed.entries ?? []).map((entry) => entry.key).filter(Boolean) as string[]);
  } catch {
    // The bibliography's own schema failure is reported by the integrity
    // checks, with a message that names the file. Failing here would replace it
    // with a stack trace from inside the Markdown pipeline.
    return new Set();
  }
}

/**
 * Rewrites citation tokens in place and returns the numbering it assigned.
 *
 * Exported separately from the plugin so the tests exercise this function
 * rather than a re-implementation of it that could agree with a bug.
 */
export function citeTree(
  tree: HastNode,
  options: { known?: Set<string>; onUnknown?: (key: string) => void } = {},
): ProseCitation[] {
  const numbers = new Map<string, number>();
  const { known, onUnknown } = options;

  const numberFor = (key: string): number => {
    const existing = numbers.get(key);
    if (existing !== undefined) return existing;
    if (known && known.size > 0 && !known.has(key)) onUnknown?.(key);
    const next = numbers.size + 1;
    numbers.set(key, next);
    return next;
  };

  const visit = (node: HastNode): void => {
    if (!node.children) return;
    if (node.type === 'element' && node.tagName && SKIP_TAGS.has(node.tagName)) return;

    const out: HastNode[] = [];
    for (const child of node.children) {
      if (child.type !== 'text' || typeof child.value !== 'string') {
        visit(child);
        out.push(child);
        continue;
      }

      const text = child.value;
      TOKEN.lastIndex = 0;
      let cursor = 0;
      let match: RegExpExecArray | null;
      let replaced = false;

      while ((match = TOKEN.exec(text)) !== null) {
        replaced = true;
        if (match.index > cursor) {
          out.push({ type: 'text', value: text.slice(cursor, match.index) });
        }
        const assigned = parseKeys(match[1]!).map(numberFor);
        out.push({
          type: 'element',
          tagName: 'sup',
          properties: { className: ['citation-ref'] },
          children: [
            {
              type: 'element',
              tagName: 'a',
              properties: {
                href: `#ref-${Math.min(...assigned)}`,
                'data-citation': assigned.join(','),
              },
              children: [{ type: 'text', value: formatNumbers(assigned) }],
            },
          ],
        });
        cursor = match.index + match[0].length;
      }

      if (!replaced) {
        out.push(child);
        continue;
      }
      if (cursor < text.length) out.push({ type: 'text', value: text.slice(cursor) });
    }
    node.children = out;
  };

  visit(tree);
  return [...numbers].map(([key, number]) => ({ key, number }));
}

export interface CitationOptions {
  /** Absolute path to `src/data/references.json`. */
  referencesPath: string;
}

export default function rehypeCitations(options: CitationOptions) {
  const known = knownKeys(options.referencesPath);

  return function transformer(tree: HastNode, file: VFileLike): void {
    const unknown: string[] = [];
    const citations = citeTree(tree, { known, onUnknown: (key) => unknown.push(key) });

    if (unknown.length > 0) {
      // A citation pointing at nothing is the exact failure the whole sourcing
      // discipline exists to prevent, so it stops the build rather than
      // rendering a number with no entry behind it.
      const where = file.path ?? file.history?.[0] ?? 'a content file';
      throw new Error(
        `${where}: cites ${unknown.map((k) => `[@${k}]`).join(', ')}, which ${
          unknown.length === 1 ? 'is not a key' : 'are not keys'
        } in src/data/references.json.`,
      );
    }

    if (citations.length === 0) return;
    file.data ??= {};
    file.data.astro ??= {};
    file.data.astro.frontmatter ??= {};
    file.data.astro.frontmatter.citations = citations;
  };
}
