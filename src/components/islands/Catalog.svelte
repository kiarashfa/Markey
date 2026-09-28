<script lang="ts">
  /**
   * The catalog.
   *
   * **One filtered and sorted list drives both renderings.** The card grid and
   * the dense table are two views of the same `$derived` array, never two
   * pipelines, so they can never give different answers to "what matches".
   *
   * **Built for ten thousand entries, not a hundred.** The page server-renders
   * the first page only; the whole list is the light `catalog-index.json`,
   * fetched once on load. Results are shown a page at a time behind "Show
   * more", and every filter, the sort and the view live in the address bar, so
   * any view is a link and Back undoes a change.
   *
   * **Each facet is a menu in the toolbar**, not an open list in a sidebar that
   * grew with every term. Named vocabularies (brand, body style, powertrain,
   * drivetrain) are alphabetical; the ordinal ones (segment, positioning, era)
   * keep their natural order. Counts are taken against every other active
   * filter, so what a term says it will give is what it gives.
   *
   * **Sort field and direction are separate controls**, not a list that
   * doubles in length with every new column.
   */
  import { onMount } from 'svelte';
  import type { CatalogIndexRow } from '../../lib/content/catalogue.ts';
  import FacetMenu from './FacetMenu.svelte';

  interface VocabTerm {
    id: string;
    label: string;
  }

  type AxisKey = 'brand' | 'body' | 'powertrain' | 'drivetrain' | 'segment' | 'positioning' | 'era';

  interface Props {
    /** The first page, server-rendered. */
    initial: CatalogIndexRow[];
    /** How many entries the full list holds, for the count before it loads. */
    total: number;
    /** Base-aware URL of the light index. */
    src: string;
    /** Every axis's terms, already in display order. */
    vocab: Record<AxisKey, VocabTerm[]>;
  }

  const { initial, total, src, vocab }: Props = $props();

  const PAGE = 48;

  const AXES: { key: AxisKey; label: string; pick: (car: CatalogIndexRow) => string[] }[] = [
    { key: 'brand', label: 'Brand', pick: (c) => [c.brandId] },
    { key: 'body', label: 'Body style', pick: (c) => c.bodyStyles },
    { key: 'powertrain', label: 'Powertrain', pick: (c) => c.powertrains },
    { key: 'drivetrain', label: 'Drivetrain', pick: (c) => c.drivetrains },
    { key: 'segment', label: 'Segment', pick: (c) => (c.segment ? [c.segment] : []) },
    { key: 'positioning', label: 'Positioning', pick: (c) => (c.positioning ? [c.positioning] : []) },
    { key: 'era', label: 'Era', pick: (c) => c.eras },
  ].sort((a, b) => a.label.localeCompare(b.label)); // menus in alphabetical order, like their options

  type SortField = 'name' | 'year' | 'power' | 'zeroToHundred' | 'topSpeed' | 'consumption';
  type View = 'grid' | 'table';

  let cars = $state<CatalogIndexRow[]>(initial);
  let loadState = $state<'loading' | 'ready' | 'failed'>('loading');

  let query = $state('');
  let view = $state<View>('grid');
  let sortField = $state<SortField>('year');
  let sortAscending = $state(true);
  let limit = $state(PAGE);
  let selected = $state<Record<AxisKey, string[]>>({
    brand: [],
    body: [],
    powertrain: [],
    drivetrain: [],
    segment: [],
    positioning: [],
    era: [],
  });

  const activeFilterCount = $derived(
    Object.values(selected).reduce((n, list) => n + list.length, 0) + (query.trim() ? 1 : 0),
  );

  function clearAll() {
    query = '';
    selected = { brand: [], body: [], powertrain: [], drivetrain: [], segment: [], positioning: [], era: [] };
  }

  function passes(car: CatalogIndexRow, skip?: AxisKey): boolean {
    const needle = query.trim().toLowerCase();
    if (needle) {
      const haystack = `${car.name} ${car.brandName} ${car.generationCode ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    for (const axis of AXES) {
      if (axis.key === skip) continue;
      const wanted = selected[axis.key];
      if (wanted.length && !wanted.some((id) => axis.pick(car).includes(id))) return false;
    }
    return true;
  }

  /**
   * Cars with no figure for the sort field always sink to the bottom,
   * regardless of direction. Sorting them as zero would put every
   * under-documented car at the top of an "ascending consumption" list and
   * present a research gap as a result.
   */
  const results = $derived.by(() => {
    const direction = sortAscending ? 1 : -1;
    const key = (car: CatalogIndexRow): number | string | null => {
      switch (sortField) {
        case 'name':
          return `${car.brandName} ${car.name}`;
        case 'year':
          return car.yearStart;
        case 'power':
          return car.powerKwMax;
        case 'zeroToHundred':
          return car.zeroToHundredMinS;
        case 'topSpeed':
          return car.topSpeedMaxKmh;
        case 'consumption':
          return car.consumptionMinL100km;
      }
    };
    return cars
      .filter((car) => passes(car))
      .sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        if (ka === null && kb === null) return a.name.localeCompare(b.name);
        if (ka === null) return 1;
        if (kb === null) return -1;
        if (typeof ka === 'string' && typeof kb === 'string') return ka.localeCompare(kb) * direction;
        return ((ka as number) - (kb as number)) * direction || a.name.localeCompare(b.name);
      });
  });

  const windowed = $derived(results.slice(0, limit));

  /** What each term would leave, given every other filter; only terms with cars behind them. */
  const facets = $derived(
    AXES.map((axis) => {
      const counts: Record<string, number> = {};
      const present = new Set<string>();
      for (const car of cars) {
        for (const id of axis.pick(car)) present.add(id);
        if (!passes(car, axis.key)) continue;
        for (const id of axis.pick(car)) counts[id] = (counts[id] ?? 0) + 1;
      }
      return {
        ...axis,
        counts,
        terms: vocab[axis.key].filter((t) => present.has(t.id) || selected[axis.key].includes(t.id)),
      };
    }),
  );

  const labelOf = (axis: AxisKey, id: string) => vocab[axis].find((t) => t.id === id)?.label ?? id;

  /* A changed question starts again at the top of its answer. */
  $effect(() => {
    void [query, selected, sortField, sortAscending];
    limit = PAGE;
  });

  /* ── The address bar ─────────────────────────────────────────────────── */

  const SORT_LABELS: Record<SortField, string> = {
    name: 'Name',
    year: 'Year',
    power: 'Power',
    zeroToHundred: '0–100 km/h',
    topSpeed: 'Top speed',
    consumption: 'Consumption',
  };

  let urlReady = $state(false);

  function readUrl() {
    const p = new URLSearchParams(location.search);
    const next = { ...selected };
    for (const axis of AXES) next[axis.key] = (p.get(axis.key) ?? '').split(',').filter(Boolean);
    selected = next;
    query = p.get('q') ?? '';
    const s = p.get('sort');
    sortField = s && s in SORT_LABELS ? (s as SortField) : 'year';
    sortAscending = p.get('dir') !== 'desc';
    view = p.get('view') === 'table' ? 'table' : 'grid';
  }

  $effect(() => {
    if (!urlReady) return;
    const p = new URLSearchParams();
    if (query.trim()) p.set('q', query.trim());
    for (const axis of AXES) if (selected[axis.key].length) p.set(axis.key, selected[axis.key].join(','));
    if (sortField !== 'year') p.set('sort', sortField);
    if (!sortAscending) p.set('dir', 'desc');
    if (view === 'table') p.set('view', 'table');
    const qs = p.toString();
    const next = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
    if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', next);
  });

  onMount(() => {
    readUrl();
    urlReady = true;
    fetch(src)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((rows: CatalogIndexRow[]) => {
        cars = rows;
        loadState = 'ready';
      })
      .catch(() => (loadState = 'failed'));
  });

  const years = (car: CatalogIndexRow) =>
    car.yearEnd === null ? `${car.yearStart}–present` : `${car.yearStart}–${car.yearEnd}`;

  const num = (n: number | null, unit: string, decimals = 0) =>
    n === null
      ? '—'
      : `${n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${unit}`;
</script>

<div class="flex flex-col gap-4">
  <!-- Controls: search, sort and view on one row; the facet menus on the next. -->
  <div class="relative z-20 flex flex-col gap-3">
    <!-- Row one: the tools that shape the list. Every control is 40px tall and
         the search takes the rest, so the row is filled edge to edge. -->
    <div class="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap max-sm:[&>*:last-child:nth-child(even)]:col-span-2">
      <label class="col-span-2 min-w-0 sm:flex-1 sm:basis-60">
        <span class="sr-only">Search the catalog</span>
        <input
          type="search"
          bind:value={query}
          placeholder="Search by name, brand or code…"
          class="h-10 w-full rounded-full border border-line bg-surface-1 px-4 text-sm placeholder:text-ink-muted focus:border-[var(--color-ink-muted)] focus:outline-none"
        />
      </label>

      <label class="flex items-center text-xs text-ink-secondary">
        <span class="sr-only">Sort by</span>
        <select
          data-pagefind-ignore
          bind:value={sortField}
          class="h-10 w-full rounded-full border border-line bg-surface-1 px-4 text-[13px] font-medium text-ink focus:border-line-strong focus:outline-none"
        >
          {#each Object.entries(SORT_LABELS) as [field, label] (field)}
            <option value={field}>{label}</option>
          {/each}
        </select>
      </label>

      <button
        type="button"
        class="pressable h-10 rounded-full border border-line px-4 text-[13px] font-medium text-ink-secondary transition-colors duration-150 hover:border-line-strong hover:text-ink"
        onclick={() => (sortAscending = !sortAscending)}
        aria-label={sortAscending ? 'Sorted ascending; switch to descending' : 'Sorted descending; switch to ascending'}
      >
        <span class="whitespace-nowrap">{sortAscending ? '↑ Ascending' : '↓ Descending'}</span>
      </button>

      <div class="flex h-10 items-center gap-1 rounded-full border border-line bg-surface-1 p-1">
        {#each [['grid', 'Cards'], ['table', 'Table']] as [value, label] (value)}
          <button
            type="button"
            class={`h-full flex-1 rounded-full px-3.5 text-xs font-medium transition-colors duration-150 ${view === value ? 'bg-surface-3 text-ink' : 'text-ink-secondary'}`}
            aria-pressed={view === value}
            onclick={() => (view = value as View)}
          >
            {label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Row two: the list menus, in alphabetical order, each stretched so the
         row is filled. -->
    <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center max-sm:[&>*:last-child:nth-child(odd)]:col-span-2">
      {#each facets as facet (facet.key)}
        {#if facet.terms.length > 1 || selected[facet.key].length > 0}
          <FacetMenu
            fill
            label={facet.label}
            terms={facet.terms}
            counts={facet.counts}
            selected={selected[facet.key]}
            onchange={(next) => (selected = { ...selected, [facet.key]: next })}
          />
        {/if}
      {/each}
    </div>

    <!-- What is filtering the list right now, each chip removing its own filter. -->
    {#if activeFilterCount > 0}
      <div class="flex flex-wrap items-center gap-1.5">
        {#if query.trim()}
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-accent)] px-2.5 py-0.5 text-xs text-ink"
            onclick={() => (query = '')}>“{query.trim()}” <span aria-hidden="true" class="text-ink-muted">×</span></button
          >
        {/if}
        {#each AXES as axis (axis.key)}
          {#each selected[axis.key] as id (id)}
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-full border border-[var(--brand-accent)] px-2.5 py-0.5 text-xs text-ink"
              aria-label={`Remove ${labelOf(axis.key, id)}`}
              onclick={() => (selected = { ...selected, [axis.key]: selected[axis.key].filter((x) => x !== id) })}
            >
              {labelOf(axis.key, id)} <span aria-hidden="true" class="text-ink-muted">×</span>
            </button>
          {/each}
        {/each}
        <button type="button" class="ml-1 text-xs text-ink-secondary underline underline-offset-2 hover:text-ink" onclick={clearAll}>
          Clear all
        </button>
      </div>
    {/if}
  </div>

  <p class="text-sm text-ink-secondary" aria-live="polite">
    {#if loadState === 'loading'}
      Showing {windowed.length} of {total} cars · loading the rest…
    {:else if loadState === 'failed'}
      The full list could not be loaded; these are the first {cars.length} of {total} cars.
    {:else}
      {results.length}
      {results.length === 1 ? 'car' : 'cars'}
      {#if results.length !== cars.length}<span class="text-ink-muted"> of {cars.length}</span>{/if}
    {/if}
  </p>

  {#if results.length === 0}
    <div class="rounded-lg border border-line bg-surface-1 p-6 text-center">
      <p class="text-sm text-ink-secondary">Nothing matches those filters.</p>
      <button
        type="button"
        class="pressable mt-3 rounded-full border border-line bg-surface-2 px-3.5 py-1.5 text-sm font-medium"
        onclick={clearAll}
      >
        Clear all filters
      </button>
    </div>
  {:else if view === 'grid'}
    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each windowed as car (car.id)}
        <li class="min-w-0">
          <a
            href={car.url}
            class="pressable group flex h-full min-w-0 gap-4 rounded-lg border border-line bg-surface-1 p-4 transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
            style={`--brand-accent: ${car.accentColor};`}
          >
            <span class="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white p-1">
              <img src={car.logoSrc} alt="" class="size-full object-contain" loading="lazy" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-ink-muted">
                {car.brandName}{car.generationCode ? ` · ${car.generationCode}` : ''}
              </span>
              <span class="type-heading mt-1 block truncate text-base group-hover:underline">{car.name}</span>
              <span class="type-data mt-1 block text-sm text-ink-secondary">{years(car)}</span>
              {#if car.powerKwMax !== null || car.zeroToHundredMinS !== null}
                <span class="type-data mt-2 block text-xs text-ink-muted">
                  {#if car.powerKwMax !== null}{num(car.powerKwMax, 'kW')}{/if}
                  {#if car.powerKwMax !== null && car.zeroToHundredMinS !== null}
                    ·
                  {/if}
                  {#if car.zeroToHundredMinS !== null}{num(car.zeroToHundredMinS, 's', 1)} to 100{/if}
                </span>
              {/if}
            </span>
            <span aria-hidden="true" class="w-1 shrink-0 self-stretch rounded-full opacity-70" style="background-color: var(--brand-accent);"
            ></span>
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-line">
      <table class="type-data w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr class="border-b border-line bg-surface-2 text-left">
            <th scope="col" class="px-3 py-2 font-medium">Car</th>
            <th scope="col" class="px-3 py-2 font-medium">Years</th>
            <th scope="col" class="px-3 py-2 text-right font-medium">Power</th>
            <th scope="col" class="px-3 py-2 text-right font-medium">0–100</th>
            <th scope="col" class="px-3 py-2 text-right font-medium">Top speed</th>
            <th scope="col" class="px-3 py-2 text-right font-medium">Consumption</th>
          </tr>
        </thead>
        <tbody>
          {#each windowed as car (car.id)}
            <tr class="border-b border-line last:border-b-0 hover:bg-surface-1">
              <th scope="row" class="px-3 py-2 text-left font-normal">
                <a class="font-medium hover:underline" href={car.url}>{car.name}</a>
                <span class="block text-xs text-ink-muted">{car.brandName}</span>
              </th>
              <td class="whitespace-nowrap px-3 py-2 text-ink-secondary">{years(car)}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(car.powerKwMax, 'kW')}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(car.zeroToHundredMinS, 's', 1)}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(car.topSpeedMaxKmh, 'km/h')}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(car.consumptionMinL100km, 'L/100 km', 1)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-ink-muted">A missing figure is shown as a gap, never as a zero.</p>
  {/if}

  {#if results.length > windowed.length}
    <div class="flex flex-col items-center gap-2 pt-2">
      <button
        type="button"
        class="pressable rounded-full border border-line-strong px-6 py-2.5 text-sm font-medium transition-colors duration-150 hover:bg-surface-2"
        onclick={() => (limit += PAGE)}
      >
        Show {Math.min(PAGE, results.length - windowed.length)} more
      </button>
      <span class="text-xs text-ink-muted">{windowed.length} of {results.length} shown</span>
    </div>
  {/if}
</div>
