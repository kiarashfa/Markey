<script lang="ts">
  /**
   * The catalog — SPEC.md §9.1.
   *
   * **One filtered and sorted list drives both renderings.** The card grid and
   * the dense table are two views of the same `$derived` array, never two
   * pipelines — so they can never give different answers to "what matches",
   * which is the failure this structure exists to prevent.
   *
   * **Facets only offer terms with a live match.** A dropdown listing options
   * that lead to zero results wastes the visitor's time and makes the catalog
   * feel broken; the counts come from the currently-filtered set, so what you
   * see is what you will get.
   *
   * **Sort field and direction are separate controls**, not a single list of
   * "Price ascending / Price descending / Name ascending / …" that doubles in
   * length with every new column.
   *
   * Data arrives as a prop from `buildCatalogue()`, the same builder behind
   * `/catalogue.json`, so the browsable catalog and the machine-readable
   * export cannot disagree.
   */
  import type { CatalogueCar } from '../../lib/content/catalogue.ts';

  interface VocabTerm {
    id: string;
    label: string;
  }

  interface Props {
    cars: CatalogueCar[];
    bodyStyleTerms: VocabTerm[];
    powertrainTerms: VocabTerm[];
    drivetrainTerms: VocabTerm[];
    segmentTerms: VocabTerm[];
    positioningTerms: VocabTerm[];
  }

  let {
    cars,
    bodyStyleTerms,
    powertrainTerms,
    drivetrainTerms,
    segmentTerms,
    positioningTerms,
  }: Props = $props();

  type SortField = 'name' | 'year' | 'power' | 'zeroToHundred' | 'topSpeed' | 'consumption';
  type View = 'grid' | 'table';

  let query = $state('');
  let view = $state<View>('grid');
  let sortField = $state<SortField>('year');
  let sortAscending = $state(true);

  let selectedBodyStyles = $state<string[]>([]);
  let selectedPowertrains = $state<string[]>([]);
  let selectedDrivetrains = $state<string[]>([]);
  let selectedSegments = $state<string[]>([]);
  let selectedPositioning = $state<string[]>([]);

  const activeFilterCount = $derived(
    selectedBodyStyles.length +
      selectedPowertrains.length +
      selectedDrivetrains.length +
      selectedSegments.length +
      selectedPositioning.length +
      (query.trim() ? 1 : 0),
  );

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function clearAll() {
    query = '';
    selectedBodyStyles = [];
    selectedPowertrains = [];
    selectedDrivetrains = [];
    selectedSegments = [];
    selectedPositioning = [];
  }

  /** Matches any selected term, or everything when nothing is selected. */
  function matchesAny(selected: string[], has: string[]): boolean {
    return selected.length === 0 || selected.some((s) => has.includes(s));
  }

  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return cars.filter((car) => {
      if (needle) {
        const haystack = `${car.name} ${car.brandName} ${car.generationCode ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (!matchesAny(selectedBodyStyles, car.bodyStyles)) return false;
      if (!matchesAny(selectedPowertrains, car.powertrains)) return false;
      if (!matchesAny(selectedDrivetrains, car.drivetrains)) return false;
      if (!matchesAny(selectedSegments, car.segment ? [car.segment] : [])) return false;
      if (!matchesAny(selectedPositioning, car.positioning ? [car.positioning] : [])) return false;
      return true;
    });
  });

  /**
   * Sorted result.
   *
   * Cars with no figure for the sort field always sink to the bottom,
   * regardless of direction. Sorting them as zero would put every
   * under-documented car at the top of an "ascending consumption" list and
   * present a research gap as a result.
   */
  const results = $derived.by(() => {
    const direction = sortAscending ? 1 : -1;
    const key = (car: CatalogueCar): number | string | null => {
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

    return [...filtered].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka === null && kb === null) return 0;
      if (ka === null) return 1;
      if (kb === null) return -1;
      if (typeof ka === 'string' && typeof kb === 'string') return ka.localeCompare(kb) * direction;
      return ((ka as number) - (kb as number)) * direction;
    });
  });

  /**
   * How many of the current results each term would match.
   *
   * Counted against the set filtered by *every other* facet, so a count tells
   * you what selecting that term would actually give you rather than what it
   * would give you in isolation.
   */
  function facetCounts(
    terms: VocabTerm[],
    pick: (car: CatalogueCar) => string[],
    selected: string[],
  ): { term: VocabTerm; count: number; selected: boolean }[] {
    const base = cars.filter((car) => {
      const needle = query.trim().toLowerCase();
      if (needle) {
        const haystack = `${car.name} ${car.brandName} ${car.generationCode ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      if (pick !== pickBodyStyles && !matchesAny(selectedBodyStyles, car.bodyStyles)) return false;
      if (pick !== pickPowertrains && !matchesAny(selectedPowertrains, car.powertrains)) return false;
      if (pick !== pickDrivetrains && !matchesAny(selectedDrivetrains, car.drivetrains)) return false;
      if (pick !== pickSegment && !matchesAny(selectedSegments, car.segment ? [car.segment] : []))
        return false;
      if (
        pick !== pickPositioning &&
        !matchesAny(selectedPositioning, car.positioning ? [car.positioning] : [])
      )
        return false;
      return true;
    });

    return terms
      .map((term) => ({
        term,
        count: base.filter((car) => pick(car).includes(term.id)).length,
        selected: selected.includes(term.id),
      }))
      // A term with no live match is dropped unless it is currently selected —
      // hiding a selected filter would make it impossible to switch off.
      .filter((row) => row.count > 0 || row.selected);
  }

  const pickBodyStyles = (car: CatalogueCar) => car.bodyStyles;
  const pickPowertrains = (car: CatalogueCar) => car.powertrains;
  const pickDrivetrains = (car: CatalogueCar) => car.drivetrains;
  const pickSegment = (car: CatalogueCar) => (car.segment ? [car.segment] : []);
  const pickPositioning = (car: CatalogueCar) => (car.positioning ? [car.positioning] : []);

  const facets = $derived([
    {
      key: 'body-style',
      label: 'Body style',
      rows: facetCounts(bodyStyleTerms, pickBodyStyles, selectedBodyStyles),
      onToggle: (id: string) => (selectedBodyStyles = toggle(selectedBodyStyles, id)),
    },
    {
      key: 'powertrain',
      label: 'Powertrain',
      rows: facetCounts(powertrainTerms, pickPowertrains, selectedPowertrains),
      onToggle: (id: string) => (selectedPowertrains = toggle(selectedPowertrains, id)),
    },
    {
      key: 'drivetrain',
      label: 'Drivetrain',
      rows: facetCounts(drivetrainTerms, pickDrivetrains, selectedDrivetrains),
      onToggle: (id: string) => (selectedDrivetrains = toggle(selectedDrivetrains, id)),
    },
    {
      key: 'segment',
      label: 'Segment',
      rows: facetCounts(segmentTerms, pickSegment, selectedSegments),
      onToggle: (id: string) => (selectedSegments = toggle(selectedSegments, id)),
    },
    {
      key: 'positioning',
      label: 'Positioning',
      rows: facetCounts(positioningTerms, pickPositioning, selectedPositioning),
      onToggle: (id: string) => (selectedPositioning = toggle(selectedPositioning, id)),
    },
  ]);

  const SORT_LABELS: Record<SortField, string> = {
    name: 'Name',
    year: 'Year',
    power: 'Power',
    zeroToHundred: '0–100 km/h',
    topSpeed: 'Top speed',
    consumption: 'Consumption',
  };

  const years = (car: CatalogueCar) =>
    car.yearEnd === null ? `${car.yearStart}–present` : `${car.yearStart}–${car.yearEnd}`;

  const num = (n: number | null, unit: string, decimals = 0) =>
    n === null ? '—' : `${n.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${unit}`;
</script>

<div class="flex flex-col gap-5">
  <!-- Controls -->
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <label class="min-w-0 flex-1">
        <span class="sr-only">Search the catalog</span>
        <input
          type="search"
          bind:value={query}
          placeholder="Search by name, brand or code…"
          class="w-full rounded-lg border border-line bg-surface-1 px-3.5 py-2.5 text-sm placeholder:text-ink-muted focus:border-line-strong focus:outline-none"
        />
      </label>

      <div class="flex items-center gap-1 rounded-lg border border-line bg-surface-1 p-1">
        <button
          type="button"
          class="rounded px-2.5 py-1.5 text-xs font-medium transition-colors duration-150"
          style={view === 'grid' ? 'background-color: var(--color-surface-3);' : ''}
          aria-pressed={view === 'grid'}
          onclick={() => (view = 'grid')}
        >
          Cards
        </button>
        <button
          type="button"
          class="rounded px-2.5 py-1.5 text-xs font-medium transition-colors duration-150"
          style={view === 'table' ? 'background-color: var(--color-surface-3);' : ''}
          aria-pressed={view === 'table'}
          onclick={() => (view = 'table')}
        >
          Table
        </button>
      </div>
    </div>

    <!-- Sort field and direction are separate controls (SPEC §9.1). -->
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-2 text-xs text-ink-secondary">
        Sort by
        <select data-pagefind-ignore
          bind:value={sortField}
          class="rounded-md border border-line bg-surface-1 px-2 py-1.5 text-xs text-ink focus:border-line-strong focus:outline-none"
        >
          {#each Object.entries(SORT_LABELS) as [field, label] (field)}
            <option value={field}>{label}</option>
          {/each}
        </select>
      </label>

      <button
        type="button"
        class="pressable rounded-md border border-line bg-surface-1 px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 hover:border-line-strong"
        onclick={() => (sortAscending = !sortAscending)}
        aria-label={sortAscending ? 'Sort descending' : 'Sort ascending'}
      >
        {sortAscending ? '↑ Ascending' : '↓ Descending'}
      </button>

      {#if activeFilterCount > 0}
        <button
          type="button"
          class="pressable rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 hover:border-line-strong"
          onclick={clearAll}
        >
          Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
        </button>
      {/if}
    </div>
  </div>

  <div class="grid gap-6 lg:grid-cols-[minmax(0,14rem)_1fr] lg:items-start">
    <!-- Facets -->
    <aside class="flex flex-col gap-4 lg:sticky lg:top-20">
      {#each facets as facet (facet.key)}
        {#if facet.rows.length > 0}
          <fieldset class="min-w-0 rounded-lg border border-line bg-surface-1 p-3">
            <legend class="px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
              {facet.label}
            </legend>
            <ul class="mt-1 flex flex-col gap-0.5">
              {#each facet.rows as row (row.term.id)}
                <li>
                  <label
                    class="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm transition-colors duration-150 hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      checked={row.selected}
                      onchange={() => facet.onToggle(row.term.id)}
                      class="size-3.5 shrink-0 accent-[var(--brand-accent)]"
                    />
                    <span class="min-w-0 flex-1 truncate">{row.term.label}</span>
                    <span class="shrink-0 text-xs tabular-nums text-ink-muted">{row.count}</span>
                  </label>
                </li>
              {/each}
            </ul>
          </fieldset>
        {/if}
      {/each}
    </aside>

    <!-- Results -->
    <div class="min-w-0">
      <p class="mb-3 text-sm text-ink-secondary" aria-live="polite">
        {results.length}
        {results.length === 1 ? 'car' : 'cars'}
        {#if activeFilterCount > 0}<span class="text-ink-muted"> of {cars.length}</span>{/if}
      </p>

      {#if results.length === 0}
        <div class="rounded-lg border border-line bg-surface-1 p-6 text-center">
          <p class="text-sm text-ink-secondary">Nothing matches those filters.</p>
          <button
            type="button"
            class="pressable mt-3 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium"
            onclick={clearAll}
          >
            Clear all filters
          </button>
        </div>
      {:else if view === 'grid'}
        <ul class="grid gap-3 sm:grid-cols-2">
          {#each results as car (car.id)}
            <li class="min-w-0">
              <a
                href={car.url}
                class="pressable group flex h-full min-w-0 gap-4 rounded-lg border border-line bg-surface-1 p-4 transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
                style={`--brand-accent: ${car.accentColor};`}
              >
                <span
                  class="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white p-1"
                >
                  <img src={car.logoSrc} alt="" class="size-full object-contain" loading="lazy" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-ink-muted">
                    {car.brandName}{car.generationCode ? ` · ${car.generationCode}` : ''}
                  </span>
                  <span class="type-heading mt-1 block truncate text-base group-hover:underline">
                    {car.name}
                  </span>
                  <span class="type-data mt-1 block text-sm text-ink-secondary">{years(car)}</span>
                  {#if car.powerKwMax !== null || car.zeroToHundredMinS !== null}
                    <span class="type-data mt-2 block text-xs text-ink-muted">
                      {#if car.powerKwMax !== null}{num(car.powerKwMax, 'kW')}{/if}
                      {#if car.powerKwMax !== null && car.zeroToHundredMinS !== null} · {/if}
                      {#if car.zeroToHundredMinS !== null}{num(car.zeroToHundredMinS, 's', 1)} to 100{/if}
                    </span>
                  {/if}
                </span>
                <span
                  aria-hidden="true"
                  class="w-1 shrink-0 self-stretch rounded-full opacity-70"
                  style="background-color: var(--brand-accent);"
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
              {#each results as car (car.id)}
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
        <p class="mt-2 text-xs text-ink-muted">
          An em dash means we do not have that figure yet — it is not a zero.
        </p>
      {/if}
    </div>
  </div>
</div>
