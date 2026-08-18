<script lang="ts">
  /**
   * Full-text search over the whole site — SPEC.md §9.1, §12.
   *
   * This is the *other* half of the search split the spec describes. The
   * catalog's own box filters structured records — names, brands, codes — and
   * answers "which cars match these constraints". This one reads a Pagefind
   * index built from the rendered pages, and answers "where does the site say
   * anything about this", which includes prose the catalog has no column for:
   * the methodology page, a brand's history, a concept explainer.
   *
   * **The index does not exist until the site is built.** Pagefind runs after
   * `astro build` and writes `dist/pagefind/`, so in `astro dev` there is
   * genuinely nothing to search. That is stated plainly rather than left as a
   * box that swallows what you type — a search field that silently does
   * nothing is the most frustrating possible failure.
   *
   * The import is a runtime `import(/* @vite-ignore *\/ url)` on a path built
   * at call time. Vite must not try to resolve it: the file is not in `src/`,
   * does not exist during the build that would bundle it, and is fetched from
   * the deployed site like any other asset.
   */

  interface Props {
    /** `/Markey/pagefind/pagefind.js` — base-path-aware, resolved by the page. */
    indexUrl: string;
  }

  let { indexUrl }: Props = $props();

  interface SubResult {
    title: string;
    url: string;
    excerpt: string;
  }
  interface Result {
    id: string;
    url: string;
    title: string;
    excerpt: string;
    section: string | null;
    subResults: SubResult[];
  }

  type PagefindModule = {
    init: () => Promise<void>;
    debouncedSearch: (
      term: string,
      options?: unknown,
      delay?: number,
    ) => Promise<{ results: { id: string; data: () => Promise<PagefindData> }[] } | null>;
    filters: () => Promise<Record<string, Record<string, number>>>;
  };

  interface PagefindData {
    url: string;
    meta?: Record<string, string>;
    excerpt: string;
    filters?: Record<string, string[]>;
    sub_results?: { title: string; url: string; excerpt: string }[];
  }

  let query = $state('');
  let section = $state('');
  let results = $state<Result[]>([]);
  let sections = $state<string[]>([]);
  let searching = $state(false);
  let searched = $state(false);
  /** null while unknown, false when there is no index to load. */
  let available = $state<boolean | null>(null);

  let pagefind: PagefindModule | null = null;

  async function load(): Promise<PagefindModule | null> {
    if (pagefind) return pagefind;
    try {
      const module = (await import(/* @vite-ignore */ indexUrl)) as PagefindModule;
      await module.init();
      pagefind = module;
      available = true;
      try {
        const filters = await module.filters();
        sections = Object.keys(filters.section ?? {}).sort();
      } catch {
        // Filters are a nicety; a working search without them beats no search.
        sections = [];
      }
      return module;
    } catch {
      available = false;
      return null;
    }
  }

  /**
   * Pagefind's result URL, ready to link.
   *
   * **The base path is already on it.** The index stores the path the file sat
   * at inside `dist/` — `/cars/toyota-86-zn6/` — and `pagefind.js` prefixes its
   * own location back on at runtime, so loading it from
   * `/Markey/pagefind/pagefind.js` yields `/Markey/cars/toyota-86-zn6/`.
   * Prefixing again produced `/Markey/Markey/…`, which is how this was found.
   * So the only work left is cosmetic.
   */
  function toPath(url: string): string {
    return url.replace(/index\.html$/, '').replace(/\.html$/, '/');
  }

  async function run() {
    const term = query.trim();
    if (term.length < 2) {
      results = [];
      searched = false;
      return;
    }

    const module = await load();
    if (!module) return;

    searching = true;
    const filters = section ? { section: [section] } : undefined;
    const response = await module.debouncedSearch(term, filters ? { filters } : undefined, 220);
    // `debouncedSearch` resolves to null for a superseded call — the visitor
    // has typed on, and rendering this answer would show results for a query
    // they can no longer see.
    if (response === null) return;

    const loaded = await Promise.all(response.results.slice(0, 20).map((r) => r.data()));
    results = loaded.map((data, index) => ({
      id: response.results[index]!.id,
      url: toPath(data.url),
      title: data.meta?.title ?? 'Untitled page',
      excerpt: data.excerpt,
      section: data.filters?.section?.[0] ?? null,
      subResults: (data.sub_results ?? []).slice(1, 4).map((sub) => ({
        title: sub.title,
        url: toPath(sub.url),
        excerpt: sub.excerpt,
      })),
    }));
    searching = false;
    searched = true;
  }

  // Read `?q=` on mount, so a search is linkable and the header box can hand
  // its term over by navigating here.
  $effect(() => {
    const params = new URLSearchParams(window.location.search);
    const initial = params.get('q');
    if (initial) {
      query = initial;
      run();
    } else {
      load();
    }
  });

  function onInput() {
    run();
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set('q', query.trim());
    else url.searchParams.delete('q');
    window.history.replaceState({}, '', url);
  }

  function chooseSection(value: string) {
    section = section === value ? '' : value;
    run();
  }
</script>

<div class="flex flex-col gap-6">
  <div>
    <label class="block">
      <span class="sr-only">Search everything on this site</span>
      <input
        type="search"
        bind:value={query}
        oninput={onInput}
        placeholder="Search cars, brands, concepts and methodology…"
        autocomplete="off"
        class="w-full rounded-lg border border-line bg-surface-1 px-4 py-3 text-base focus:border-line-strong focus:outline-none"
      />
    </label>

    {#if sections.length > 0}
      <div class="mt-3 flex flex-wrap gap-2">
        {#each sections as name (name)}
          <button
            type="button"
            class="pressable rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 {section ===
            name
              ? 'border-line-strong bg-surface-3 text-ink'
              : 'border-line bg-surface-2 text-ink-secondary'}"
            onclick={() => chooseSection(name)}
            aria-pressed={section === name}
          >
            {name}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if available === false}
    <div class="rounded-lg border border-dashed border-line bg-surface-1 p-6">
      <h2 class="type-heading text-base">The search index isn't here</h2>
      <p class="mt-2 max-w-prose text-sm text-ink-secondary">
        Full-text search reads an index built from the finished pages, after the
        site is built. During local development that index does not exist yet,
        so there is nothing to search rather than something searching badly.
      </p>
      <p class="mt-3 max-w-prose text-sm text-ink-secondary">
        Everything is still reachable without it: the catalog's own filters work
        on structured data and need no index at all.
      </p>
    </div>
  {:else if query.trim().length > 0 && query.trim().length < 2}
    <p class="text-sm text-ink-muted">Keep going — two characters or more.</p>
  {:else if searching && results.length === 0}
    <p class="text-sm text-ink-muted">Searching…</p>
  {:else if searched && results.length === 0}
    <div class="rounded-lg border border-dashed border-line bg-surface-1 p-6">
      <p class="text-sm text-ink-secondary">
        Nothing on the site matches <strong class="text-ink">{query.trim()}</strong>.
      </p>
      <p class="mt-2 max-w-prose text-xs text-ink-muted">
        The catalog is deliberately small while the model and the sourcing
        pipeline are proven. A missing car is a gap in our research, not a
        statement that the car is unimportant.
      </p>
    </div>
  {:else if results.length > 0}
    <div>
      <p class="text-xs uppercase tracking-wide text-ink-muted">
        {results.length}
        {results.length === 1 ? 'page' : 'pages'}
        {section ? `in ${section}` : ''}
      </p>
      <ul class="mt-3 flex flex-col gap-3">
        {#each results as result (result.id)}
          <li class="min-w-0 rounded-lg border border-line bg-surface-1 p-4">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <a class="type-heading text-base hover:underline" href={result.url}>
                {result.title}
              </a>
              {#if result.section}
                <span class="text-[0.6875rem] uppercase tracking-wide text-ink-muted">
                  {result.section}
                </span>
              {/if}
            </div>
            <!--
              Pagefind returns the excerpt with <mark> around the hit.
              `break-words`, because an excerpt is arbitrary text from an
              arbitrary page and a single long token would otherwise push the
              card past the viewport.
            -->
            <p class="mt-1.5 break-words text-sm leading-relaxed text-ink-secondary">
              {@html result.excerpt}
            </p>

            {#if result.subResults.length > 0}
              <ul class="mt-3 flex flex-col gap-1.5 border-l border-line pl-3">
                {#each result.subResults as sub (sub.url)}
                  <li class="min-w-0">
                    <a class="break-words text-sm hover:underline" href={sub.url}>{sub.title}</a>
                    <p class="break-words text-xs leading-relaxed text-ink-muted">
                      {@html sub.excerpt}
                    </p>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  /* Pagefind wraps each hit in <mark>; the default yellow fights both themes. */
  :global(mark) {
    background-color: color-mix(in oklab, var(--brand-accent) 22%, transparent);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
