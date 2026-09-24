<script lang="ts">
  /**
   * A sortable, filterable list of catalogue entries.
   *
   * Built for the size the catalogue is *going* to be. A grid of cards is fine
   * for the four entries a brand has today and useless at fifty: you cannot
   * find the 1980s ones, you cannot see which is quickest, and you scroll past
   * the one you wanted. This is the shape that survives that growth — a search
   * box, a couple of facets, sortable columns, and a count that tells you what
   * you are looking at.
   *
   * **It reads `CatalogueCar`**, the same flattened record the catalog page,
   * `/catalogue.json` and the comparison tool read. One builder,
   * one set of numbers: this table cannot disagree with the catalog about which
   * car is faster, because there is no second source of that answer.
   *
   * **Cards on narrow screens, a table on wide ones.** Not a table squeezed
   * into 375px with a horizontal scrollbar — the same records, laid out the way
   * each width can actually show them. Both come from one filtered array, so
   * they can never show different things.
   */
  import type { CatalogueCar } from '../../lib/content/catalogue.ts';

  export interface EntryTableFacet {
    /** Shown above the control. */
    label: string;
    /** Which flattened field to match on. */
    field: 'bodyStyles' | 'powertrains' | 'drivetrains' | 'eras';
    terms: { id: string; label: string }[];
  }

  interface Props {
    cars: CatalogueCar[];
    facets?: EntryTableFacet[];
    /** Hidden when every row is the same brand, as on a brand page. */
    showBrand?: boolean;
    /** Announced as the table's caption. */
    caption: string;
    /** Shown when nothing matches. */
    emptyNote?: string;
  }

  let {
    cars,
    facets = [],
    showBrand = true,
    caption,
    emptyNote = 'Nothing matches those filters.',
  }: Props = $props();

  type SortKey = 'name' | 'year' | 'power' | 'zeroToHundred' | 'topSpeed' | 'mass';

  interface Column {
    key: SortKey;
    label: string;
    /** Which way round "best first" is for this column. */
    initialDirection: 'asc' | 'desc';
    numeric: boolean;
    get: (car: CatalogueCar) => number | string | null;
    render: (car: CatalogueCar) => string;
  }

  const fmt = (value: number | null, digits = 0, unit = '') =>
    value === null
      ? '—'
      : `${value.toLocaleString('en-GB', {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        })}${unit ? ` ${unit}` : ''}`;

  const COLUMNS: Column[] = [
    {
      key: 'name',
      label: 'Name',
      initialDirection: 'asc',
      numeric: false,
      get: (car) => car.name,
      render: (car) => car.name,
    },
    {
      key: 'year',
      label: 'Produced',
      initialDirection: 'desc',
      numeric: true,
      get: (car) => car.yearStart,
      render: (car) => (car.yearEnd === null ? `${car.yearStart}–` : `${car.yearStart}–${car.yearEnd}`),
    },
    {
      key: 'power',
      label: 'Power',
      initialDirection: 'desc',
      numeric: true,
      get: (car) => car.powerKwMax,
      render: (car) => fmt(car.powerKwMax, 0, 'kW'),
    },
    {
      key: 'zeroToHundred',
      label: '0–100',
      initialDirection: 'asc',
      numeric: true,
      get: (car) => car.zeroToHundredMinS,
      render: (car) => fmt(car.zeroToHundredMinS, 1, 's'),
    },
    {
      key: 'topSpeed',
      label: 'Top speed',
      initialDirection: 'desc',
      numeric: true,
      get: (car) => car.topSpeedMaxKmh,
      render: (car) => fmt(car.topSpeedMaxKmh, 0, 'km/h'),
    },
    {
      key: 'mass',
      label: 'Weight',
      initialDirection: 'asc',
      numeric: true,
      get: (car) => car.massMinKg,
      render: (car) => fmt(car.massMinKg, 0, 'kg'),
    },
  ];

  let query = $state('');
  let sortKey = $state<SortKey>('name');
  let direction = $state<'asc' | 'desc'>('asc');
  let chosen = $state<Record<string, string[]>>({});

  const activeFacetCount = $derived(
    Object.values(chosen).reduce((total, ids) => total + ids.length, 0),
  );
  const filtersActive = $derived(query.trim().length > 0 || activeFacetCount > 0);

  function toggleFacet(field: string, id: string) {
    const current = chosen[field] ?? [];
    chosen = {
      ...chosen,
      [field]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    };
  }

  function clearAll() {
    query = '';
    chosen = {};
  }

  /**
   * Clicking a column sorts by it; clicking it again reverses.
   *
   * A new column starts in the direction that puts the interesting end first —
   * quickest 0–100, most power, oldest first for a nameplate history. Starting
   * every column ascending would make "sort by power" mean "show me the
   * slowest", which is never what the click meant.
   */
  function sortBy(key: SortKey) {
    if (sortKey === key) {
      direction = direction === 'asc' ? 'desc' : 'asc';
      return;
    }
    sortKey = key;
    direction = COLUMNS.find((column) => column.key === key)!.initialDirection;
  }

  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return cars.filter((car) => {
      if (needle) {
        const haystack = [car.name, car.fullName, car.brandName, car.generationCode]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      for (const facet of facets) {
        const wanted = chosen[facet.field] ?? [];
        if (wanted.length === 0) continue;
        const has = car[facet.field];
        if (!wanted.some((id) => has.includes(id))) return false;
      }
      return true;
    });
  });

  const sorted = $derived.by(() => {
    const column = COLUMNS.find((c) => c.key === sortKey)!;
    const sign = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = column.get(a);
      const right = column.get(b);
      // A missing figure sorts last in both directions. Treating it as zero
      // would put every unsourced car at the top of "quickest first", which
      // reads as a claim we have not made.
      if (left === null && right === null) return a.name.localeCompare(b.name);
      if (left === null) return 1;
      if (right === null) return -1;
      if (typeof left === 'string' || typeof right === 'string') {
        return sign * String(left).localeCompare(String(right));
      }
      return sign * (left - right) || a.name.localeCompare(b.name);
    });
  });

  /** Facet terms with nothing behind them are shown disabled, never hidden. */
  const facetCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const facet of facets) {
      for (const term of facet.terms) {
        counts.set(
          `${facet.field}:${term.id}`,
          cars.filter((car) => car[facet.field].includes(term.id)).length,
        );
      }
    }
    return counts;
  });

  const ariaSort = (key: SortKey) =>
    sortKey === key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none';
</script>

<div class="flex flex-col gap-4">
  <!-- Controls -->
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <label class="min-w-0 flex-1">
        <span class="sr-only">Filter by name</span>
        <input
          type="search"
          bind:value={query}
          placeholder="Filter by name, code or brand…"
          class="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm focus:border-line-strong focus:outline-none"
        />
      </label>
      <p class="type-data shrink-0 text-xs tabular-nums text-ink-muted" aria-live="polite">
        {sorted.length} of {cars.length}
      </p>
      {#if filtersActive}
        <button
          type="button"
          class="pressable shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted transition-colors duration-150 hover:text-ink"
          onclick={clearAll}
        >
          Clear
        </button>
      {/if}
    </div>

    {#each facets as facet (facet.field)}
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <span class="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-ink-muted">
          {facet.label}
        </span>
        {#each facet.terms as term (term.id)}
          {@const count = facetCounts.get(`${facet.field}:${term.id}`) ?? 0}
          {@const active = (chosen[facet.field] ?? []).includes(term.id)}
          <button
            type="button"
            disabled={count === 0}
            aria-pressed={active}
            onclick={() => toggleFacet(facet.field, term.id)}
            class="pressable rounded-full border px-2.5 py-1 text-xs transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 {active
              ? 'border-[var(--brand-accent)] bg-[var(--brand-accent)]/12 text-ink'
              : 'border-line bg-surface-1 text-ink-secondary hover:border-line-strong hover:text-ink'}"
          >
            {term.label}
            <span class="type-data ml-1 tabular-nums text-ink-muted">{count}</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>

  {#if sorted.length === 0}
    <div class="rounded-lg border border-dashed border-line bg-surface-1 p-6 text-center">
      <p class="text-sm text-ink-secondary">{emptyNote}</p>
    </div>
  {:else}
    <!-- Wide: a real table, with sortable headers. -->
    <div class="hidden overflow-x-auto rounded-lg border border-line md:block">
      <table class="type-data w-full border-collapse text-sm">
        <caption class="sr-only">{caption}</caption>
        <thead>
          <tr class="border-b border-line bg-surface-2">
            {#each COLUMNS as column (column.key)}
              <th
                scope="col"
                aria-sort={ariaSort(column.key)}
                class="px-3 py-2 text-left font-medium {column.numeric ? 'tabular-nums' : ''}"
              >
                <button
                  type="button"
                  onclick={() => sortBy(column.key)}
                  class="inline-flex items-center gap-1 whitespace-nowrap transition-colors duration-150 hover:text-ink {sortKey ===
                  column.key
                    ? 'text-ink'
                    : 'text-ink-secondary'}"
                >
                  {column.label}
                  <span aria-hidden="true" class="text-[0.625rem] text-ink-muted">
                    {sortKey === column.key ? (direction === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </button>
              </th>
            {/each}
            {#if showBrand}
              <th scope="col" class="px-3 py-2 text-left font-medium text-ink-secondary">Brand</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#each sorted as car (car.id)}
            <tr class="border-b border-line last:border-b-0 hover:bg-surface-1">
              {#each COLUMNS as column (column.key)}
                <td class="px-3 py-2 {column.numeric ? 'tabular-nums' : ''}">
                  {#if column.key === 'name'}
                    <a
                      class="font-medium hover:underline"
                      href={car.url}
                      style={`--brand-accent: ${car.accentColor};`}
                    >
                      {car.name}
                    </a>
                    {#if car.generationCode}
                      <span class="ml-1.5 text-xs text-ink-muted">{car.generationCode}</span>
                    {/if}
                  {:else}
                    <span class={column.get(car) === null ? 'text-ink-muted' : ''}>
                      {column.render(car)}
                    </span>
                  {/if}
                </td>
              {/each}
              {#if showBrand}
                <td class="px-3 py-2 text-ink-secondary">{car.brandName}</td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Narrow: the same records as cards. -->
    <ul class="flex flex-col gap-2 md:hidden">
      {#each sorted as car (car.id)}
        <li class="min-w-0">
          <a
            href={car.url}
            class="pressable flex min-w-0 flex-col rounded-lg border border-line bg-surface-1 p-3.5 transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
            style={`--brand-accent: ${car.accentColor};`}
          >
            <span class="flex items-baseline justify-between gap-2">
              <span class="min-w-0 truncate text-sm font-medium">{car.name}</span>
              <span class="type-data shrink-0 text-xs tabular-nums text-ink-muted">
                {car.yearEnd === null ? `${car.yearStart}–` : `${car.yearStart}–${car.yearEnd}`}
              </span>
            </span>
            {#if showBrand}
              <span class="mt-0.5 text-xs text-ink-muted">{car.brandName}</span>
            {/if}
            <span class="type-data mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs tabular-nums text-ink-secondary">
              {#each COLUMNS.filter((c) => c.numeric && c.key !== 'year' && c.get(car) !== null) as column (column.key)}
                <span>
                  <span class="text-ink-muted">{column.label}</span>
                  {column.render(car)}
                </span>
              {/each}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>
