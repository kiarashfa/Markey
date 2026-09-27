<script lang="ts">
  /**
   * Search from the header, without leaving the page.
   *
   * The full `/search/` page is still where a real search session belongs — it
   * has room for excerpts, sub-results and facets. This is the other half of
   * the job: someone who knows what they want and wants to be there in two
   * keystrokes. It shows the top few hits and hands off to the full page for
   * anything more.
   *
   * **The index loads when the panel opens, not when the page does.** Pagefind
   * is a few hundred kilobytes of index and wasm; making every visitor download
   * it in case they might search would be the same mistake as shipping the wind
   * tunnel to a spec page. Opening the panel is the explicit action that pays
   * for it.
   *
   * **It degrades to a link.** Under `astro dev` there is no index at all, and
   * on a deployed site the fetch can still fail. Either way the panel says so
   * and the `/search/` link still works, because a search box that silently
   * swallows what you type is the most frustrating possible failure.
   */
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  interface Props {
    /** `/Markey/pagefind/pagefind.js`. */
    indexUrl: string;
    /** `/Markey/search/`. */
    searchUrl: string;
  }

  let { indexUrl, searchUrl }: Props = $props();

  interface Hit {
    id: string;
    url: string;
    title: string;
    section: string | null;
  }

  type PagefindModule = {
    init: () => Promise<void>;
    debouncedSearch: (
      term: string,
      options?: unknown,
      delay?: number,
    ) => Promise<{ results: { id: string; data: () => Promise<PagefindData> }[] } | null>;
  };

  interface PagefindData {
    url: string;
    meta?: Record<string, string>;
    filters?: Record<string, string[]>;
  }

  const MAX_HITS = 6;

  let open = $state(false);
  let query = $state('');
  let hits = $state<Hit[]>([]);
  let total = $state(0);
  let searching = $state(false);
  let unavailable = $state(false);
  let activeIndex = $state(-1);

  let panel = $state<HTMLDivElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let trigger = $state<HTMLButtonElement | null>(null);
  let pagefind: PagefindModule | null = null;
  let reduceMotion = $state(false);

  const fullSearchHref = $derived(
    query.trim() ? `${searchUrl}?q=${encodeURIComponent(query.trim())}` : searchUrl,
  );

  async function load(): Promise<PagefindModule | null> {
    if (pagefind) return pagefind;
    try {
      // See SiteSearch.svelte: a plain local, so Svelte's reactivity tracking
      // cannot move the `@vite-ignore` comment out of the import call.
      const url = indexUrl;
      const module = (await import(/* @vite-ignore */ url)) as PagefindModule;
      await module.init();
      pagefind = module;
      return module;
    } catch {
      unavailable = true;
      return null;
    }
  }

  /** Pagefind's runtime already prefixes the base path onto result URLs. */
  const toPath = (url: string) => url.replace(/index\.html$/, '').replace(/\.html$/, '/');

  async function run() {
    const term = query.trim();
    activeIndex = -1;
    if (term.length < 2) {
      hits = [];
      total = 0;
      return;
    }
    const module = await load();
    if (!module) return;

    searching = true;
    const response = await module.debouncedSearch(term, undefined, 180);
    // null means the visitor typed on and this answer is already stale.
    if (response === null) return;

    total = response.results.length;
    const loaded = await Promise.all(
      response.results.slice(0, MAX_HITS).map(async (result) => {
        const data = await result.data();
        return {
          id: result.id,
          url: toPath(data.url),
          title: data.meta?.title ?? 'Untitled page',
          section: data.filters?.section?.[0] ?? null,
        };
      }),
    );
    hits = loaded;
    searching = false;
  }

  function show() {
    open = true;
    // Loading here rather than on first keystroke means the index is usually
    // ready by the time a two-character query exists.
    void load();
    queueMicrotask(() => input?.focus());
  }

  function hide() {
    open = false;
    activeIndex = -1;
    trigger?.focus();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      hide();
      return;
    }
    if (event.key === 'Enter') {
      const chosen = hits[activeIndex];
      if (chosen) {
        event.preventDefault();
        window.location.href = chosen.url;
      } else if (query.trim()) {
        event.preventDefault();
        window.location.href = fullSearchHref;
      }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (hits.length === 0) return;
      event.preventDefault();
      /*
       * The cycle is [Advanced search, hit 0, … hit n-1], with -1 standing for
       * the Advanced-search row. Shifting by one makes it an ordinary modulo
       * over 0…n, which is the only version of this that is obviously right.
       */
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const slots = hits.length + 1;
      activeIndex = (((activeIndex + 1 + step) % slots) + slots) % slots - 1;
    }
  }

  $effect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = motion.matches;
    const onMotion = (event: MediaQueryListEvent) => (reduceMotion = event.matches);
    motion.addEventListener('change', onMotion);

    /* Dismiss on a click anywhere outside the panel or its trigger. `capture`,
       so it fires before a link inside the panel navigates away. */
    const onPointer = (event: PointerEvent) => {
      if (!open) return;
      const target = event.target as Node;
      if (panel?.contains(target) || trigger?.contains(target)) return;
      open = false;
    };
    document.addEventListener('pointerdown', onPointer, true);

    /* `/` focuses search, the convention on every site that has one — but not
       while the visitor is typing into something else. */
    const onGlobalKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      const typing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (typing) return;
      event.preventDefault();
      show();
    };
    document.addEventListener('keydown', onGlobalKey);

    return () => {
      motion.removeEventListener('change', onMotion);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onGlobalKey);
    };
  });
</script>

<div class="relative">
  <button
    bind:this={trigger}
    type="button"
    class="pressable inline-flex size-9 items-center justify-center rounded-full border border-line-strong text-ink-secondary transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
    aria-label="Search"
    aria-expanded={open}
    aria-haspopup="dialog"
    title="Search (press /)"
    onclick={() => (open ? hide() : show())}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      class="size-[17px]"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
    >
      <circle cx="11" cy="11" r="6.5"></circle>
      <line x1="15.8" y1="15.8" x2="20.5" y2="20.5"></line>
    </svg>
  </button>

  {#if open}
    <!--
      A short, small-distance entrance. apple-design §5: a panel that appears
      from the control that opened it reads as *that control expanding*, and
      160ms is the band where a transition registers as responsive rather than
      as something to wait for. Under `prefers-reduced-motion` it simply exists.
    -->
    <div
      bind:this={panel}
      role="dialog"
      aria-label="Search the site"
      class="material absolute right-0 top-[calc(100%+0.6rem)] z-50 w-[min(22rem,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-xl border border-line bg-surface-1/95 shadow-2xl backdrop-blur-xl"
      transition:fly={{ y: reduceMotion ? 0 : -6, duration: reduceMotion ? 0 : 160, easing: cubicOut }}
    >
      <div class="border-b border-line p-2">
        <input
          bind:this={input}
          bind:value={query}
          oninput={run}
          onkeydown={onKeydown}
          type="search"
          autocomplete="off"
          placeholder="Search Markey…"
          class="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm focus:outline-none"
        />
      </div>

      <div class="max-h-[min(24rem,60vh)] overflow-y-auto">
        {#if unavailable}
          <p class="px-3 py-4 text-xs leading-relaxed text-ink-muted">
            The search index is built when the site is built, so there is nothing
            to search here yet. Everything is still reachable through the
            catalog's own filters.
          </p>
        {:else if query.trim().length === 0}
          <p class="px-3 py-4 text-xs text-ink-muted">
            Cars, brands, concepts and the methodology behind the modelled
            figures.
          </p>
        {:else if query.trim().length < 2}
          <p class="px-3 py-4 text-xs text-ink-muted">Two characters or more.</p>
        {:else if hits.length === 0}
          <p class="px-3 py-4 text-xs text-ink-muted">
            {searching ? 'Searching…' : `Nothing matches ${query.trim()}.`}
          </p>
        {:else}
          <ul class="p-1.5">
            {#each hits as hit, index (hit.id)}
              <li>
                <a
                  href={hit.url}
                  class="flex items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors duration-100 hover:bg-surface-2"
                  class:bg-surface-2={index === activeIndex}
                  onmouseenter={() => (activeIndex = index)}
                >
                  <span class="min-w-0 truncate">{hit.title}</span>
                  {#if hit.section}
                    <span class="shrink-0 text-[0.625rem] uppercase tracking-wide text-ink-muted">
                      {hit.section}
                    </span>
                  {/if}
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <a
        href={fullSearchHref}
        class="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5 text-xs text-ink-secondary transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
        class:bg-surface-2={activeIndex === -1 && hits.length > 0}
      >
        <span>
          Advanced search
          {#if total > hits.length}
            <span class="text-ink-muted">· {total} results in all</span>
          {/if}
        </span>
        <span aria-hidden="true">&rarr;</span>
      </a>
    </div>
  {/if}
</div>
