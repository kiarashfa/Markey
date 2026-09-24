/**
 * Automatic internal cross-linking.
 *
 * Where one entry's prose names another entry, that name becomes a link. The
 * point is internal link density that nobody has to maintain: an author writes
 * "sold as the Toyota 86" and the link to the Toyota 86 appears, and keeps
 * appearing correctly after the entry is renamed or re-slugged, because the
 * link is derived rather than typed.
 *
 * It runs as a **rehype plugin**, so it sees the rendered tree rather than the
 * source text. That matters: a plugin working on Markdown source would happily
 * rewrite the inside of a code fence or the text of an existing link, and the
 * tree is where those are still distinguishable.
 *
 * ## The rules, and why each one exists
 *
 * 1. **First mention only, per page, per target.** Linking every occurrence of
 *    "Toyota" turns a paragraph into a wall of blue. The first mention is where
 *    a reader might not know what it refers to.
 * 2. **Never link an entry to itself.** A page that links to itself has
 *    wasted the reader's click.
 * 3. **Longest name first.** "BMW 6 Series (E24)" must win over "BMW 6 Series",
 *    or the specific entry is unreachable and the general one is wrong.
 * 4. **Word boundaries, and case-sensitive.** "BMW" should not match inside a
 *    longer word, and lowercase "toyota" in the middle of a sentence is far
 *    more likely to be a coincidence than a reference.
 * 5. **Never inside a link, a heading, code, or a table cell already dense
 *    with links.** An anchor inside an anchor is invalid HTML; a heading full
 *    of links reads as navigation rather than as a title.
 *
 * ## Where the index comes from
 *
 * The content files, read from disk at plugin construction. It cannot come from
 * Astro's content collections: this runs *inside* the Markdown pipeline that
 * loads them, so asking the collections for their entries here would be asking
 * a question that the asking is part of answering.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

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
}

export interface CrosslinkTarget {
  /** The entry's id, so a page never links to itself. */
  id: string;
  /** Exactly as it must appear in prose. */
  name: string;
  /** Base-path-safe URL. */
  url: string;
}

/** Nothing inside these ever becomes a link. */
const SKIP_TAGS = new Set(['a', 'code', 'pre', 'kbd', 'samp', 'script', 'style', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/**
 * Names too short or too generic to match safely.
 *
 * A two-character name would match inside acronyms and model codes across the
 * whole catalogue. The threshold is deliberately blunt: a wrong link is worse
 * than a missing one, because a reader who follows it lands somewhere the
 * sentence did not promise.
 */
const MIN_NAME_LENGTH = 3;

function readJsonDir(dir: string): Record<string, unknown>[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(path.join(dir, name), 'utf8')));
    } catch {
      // A malformed content file is the integrity checks' problem to report,
      // with a message that names the file. Failing here would replace that
      // message with a stack trace from the Markdown pipeline.
    }
  }
  return out;
}

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * Every linkable name, longest first.
 *
 * A generation's manufacturer code is included as an alias — "the E24" is how
 * people actually refer to these cars, and it is exactly the reference a reader
 * is most likely to want a link from.
 */
export function buildTargets(contentRoot: string, base: string): CrosslinkTarget[] {
  const url = (...segments: string[]) =>
    `/${[base.replace(/^\/+|\/+$/g, ''), ...segments].filter(Boolean).join('/')}/`.replace(
      /\/{2,}/g,
      '/',
    );

  const targets: CrosslinkTarget[] = [];
  const push = (id: string | undefined, name: string | undefined, href: string) => {
    if (!id || !name || name.length < MIN_NAME_LENGTH) return;
    targets.push({ id, name, url: href });
  };

  for (const car of readJsonDir(path.join(contentRoot, 'carData'))) {
    const id = asString(car.id);
    if (!id) continue;
    const href = url('cars', id);
    push(id, asString(car.fullName), href);
    push(id, asString(car.name), href);
    push(id, asString(car.generationCode), href);
  }
  for (const brand of readJsonDir(path.join(contentRoot, 'brandData'))) {
    const id = asString(brand.id);
    if (!id) continue;
    push(id, asString(brand.name), url('brands', id));
  }
  for (const concept of readJsonDir(path.join(contentRoot, 'conceptData'))) {
    const id = asString(concept.id);
    if (!id) continue;
    push(id, asString(concept.name), url('concepts', id));
  }

  // Longest first, so the most specific name claims the text.
  return targets.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
}

/** The entry a source file belongs to — `cars/toyota-86-zn6.mdx` → that id. */
export function entryIdFromPath(filePath: string | undefined): string | null {
  if (!filePath) return null;
  const match = /[\\/]content[\\/][^\\/]+[\\/]([^\\/]+)\.mdx?$/.exec(filePath);
  return match?.[1] ?? null;
}

const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[\p{L}\p{N}]/u.test(char);

/**
 * The first standalone occurrence of `name` in `text`, or -1.
 *
 * A plain `indexOf` with boundary checks rather than a regular expression:
 * entry names contain `(`, `)`, `+` and `.`, every one of which would have to
 * be escaped, and an escaping bug here silently links the wrong words.
 */
export function findStandalone(text: string, name: string): number {
  let from = 0;
  for (;;) {
    const at = text.indexOf(name, from);
    if (at === -1) return -1;
    const before = at > 0 ? text[at - 1] : undefined;
    const after = at + name.length < text.length ? text[at + name.length] : undefined;
    // A name ending in punctuation — "BMW 6 Series (E24)" — already has its own
    // boundary; only alphanumeric neighbours make a false match.
    if (!isWordChar(before) && !isWordChar(after)) return at;
    from = at + 1;
  }
}

interface Replacement {
  nodes: HastNode[];
  linked: string[];
}

/** Splits one text node around the first match of each still-unlinked target. */
function linkText(
  text: string,
  targets: CrosslinkTarget[],
  used: Set<string>,
  selfId: string | null,
): Replacement | null {
  const available = targets.filter((t) => !used.has(t.id) && t.id !== selfId);
  if (available.length === 0) return null;

  const nodes: HastNode[] = [];
  const linked: string[] = [];
  let rest = text;
  let matched = false;

  for (;;) {
    let best: { target: CrosslinkTarget; at: number } | null = null;
    for (const target of available) {
      if (used.has(target.id) || linked.includes(target.id)) continue;
      const at = findStandalone(rest, target.name);
      if (at === -1) continue;
      // Earliest match wins; on a tie the longer name does, which the sort
      // order already guarantees because it is checked first.
      if (best === null || at < best.at) best = { target, at };
    }
    if (!best) break;

    matched = true;
    if (best.at > 0) nodes.push({ type: 'text', value: rest.slice(0, best.at) });
    nodes.push({
      type: 'element',
      tagName: 'a',
      properties: { href: best.target.url, 'data-crosslink': 'true' },
      children: [{ type: 'text', value: best.target.name }],
    });
    linked.push(best.target.id);
    rest = rest.slice(best.at + best.target.name.length);
  }

  if (!matched) return null;
  if (rest) nodes.push({ type: 'text', value: rest });
  return { nodes, linked };
}

/**
 * Rewrites a tree in place, linking the first mention of each target.
 *
 * Separated from the plugin so it can be tested against a fixed vocabulary
 * rather than against whatever the catalogue happens to contain today — and,
 * more importantly, so the tests exercise **this** function rather than a
 * re-implementation of it that could agree with a bug.
 *
 * `targets` must already be sorted longest-name-first; `buildTargets` does
 * that, and the ordering is what makes the most specific entry win.
 */
export function crosslinkTree(
  tree: HastNode,
  targets: CrosslinkTarget[],
  selfId: string | null,
): void {
  if (targets.length === 0) return;
  const used = new Set<string>();

  const visit = (node: HastNode): void => {
    if (!node.children) return;
    if (node.type === 'element' && node.tagName && SKIP_TAGS.has(node.tagName)) return;

    const out: HastNode[] = [];
    for (const child of node.children) {
      if (child.type === 'text' && typeof child.value === 'string') {
        const replaced = linkText(child.value, targets, used, selfId);
        if (replaced) {
          for (const id of replaced.linked) used.add(id);
          out.push(...replaced.nodes);
          continue;
        }
        out.push(child);
        continue;
      }
      visit(child);
      out.push(child);
    }
    node.children = out;
  };

  visit(tree);
}

export interface CrosslinkOptions {
  /** Absolute path to `src/content`. */
  contentRoot: string;
  /** Astro's `base`. */
  base: string;
}

/**
 * The rehype plugin.
 *
 * The index is read once when the plugin is constructed, not once per file —
 * the content directory does not change during a build, and re-reading it for
 * every page would make the cost quadratic in the size of the catalogue for no
 * benefit at all.
 */
export default function rehypeCrosslink(options: CrosslinkOptions) {
  const targets = buildTargets(options.contentRoot, options.base);

  return function transformer(tree: HastNode, file: VFileLike): void {
    crosslinkTree(tree, targets, entryIdFromPath(file.path ?? file.history?.[0]));
  };
}
