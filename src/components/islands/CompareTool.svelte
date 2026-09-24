<script lang="ts">
  /**
   * Side-by-side comparison.
   *
   * **State lives entirely in the URL**, not in storage. A comparison is
   * something you send someone, and `?cars=a,b,c` is shareable, bookmarkable
   * and back-button-friendly without a single byte of persistence. It also
   * means the tool has no state to get out of sync with the address bar.
   *
   * `replaceState` rather than `pushState` while picking: adding a history
   * entry per checkbox would bury the page the visitor arrived from under a
   * dozen back presses.
   *
   * Rows read from the same `CatalogueCar` shape the catalog and
   * `/catalogue.json` use, so a figure here always matches the figure there.
   */
  import type { CatalogueCar } from '../../lib/content/catalogue.ts';
  import {
    BUILD_ID,
    MODELLED_ROWS,
    buildColumn,
    type CompareRowKey,
  } from '../../lib/build/compare.ts';
  import { clearBuildParams, readBuildParams, writeBuildParams } from '../../lib/build/url.ts';
  import type { BuildSpec } from '../../lib/build/spec.ts';

  let { cars, buildUrl }: { cars: CatalogueCar[]; buildUrl: string } = $props();

  const MAX = 4;

  let selected = $state<string[]>([]);
  let picking = $state(false);
  /**
   * A build from the URL — the comparison's fourth slot.
   *
   * It arrives the same way the car selection does, in the address bar, so a
   * comparison of three real cars against something you invented is one link
   * with nothing behind it.
   */
  let spec = $state<BuildSpec | null>(null);

  const build = $derived(spec ? buildColumn(spec, `${buildUrl}?${buildQuery(spec)}`) : null);

  function buildQuery(current: BuildSpec): string {
    const params = new URLSearchParams();
    writeBuildParams(params, current);
    return params.toString();
  }

  /** The build occupies a slot, so it counts against the four. */
  const chosen = $derived([
    ...(build ? [build.car] : []),
    ...selected
      .map((id) => cars.find((car) => car.id === id))
      .filter((c): c is CatalogueCar => !!c),
  ]);
  const isFull = $derived(chosen.length >= MAX);

  function syncUrl() {
    const url = new URL(window.location.href);
    if (selected.length > 0) url.searchParams.set('cars', selected.join(','));
    else url.searchParams.delete('cars');
    clearBuildParams(url.searchParams);
    if (spec) writeBuildParams(url.searchParams, spec);
    window.history.replaceState({}, '', url);
  }

  function toggle(id: string) {
    if (selected.includes(id)) selected = selected.filter((x) => x !== id);
    else if (!isFull) selected = [...selected, id];
    syncUrl();
  }

  function remove(id: string) {
    if (id === BUILD_ID) spec = null;
    else selected = selected.filter((x) => x !== id);
    syncUrl();
  }

  function clearAll() {
    selected = [];
    spec = null;
    syncUrl();
  }

  $effect(() => {
    // Read the URL once on mount. Unknown ids are dropped silently rather than
    // erroring: a link to a car that has since been re-slugged should still
    // show the cars it can, not a broken page.
    const params = new URLSearchParams(window.location.search);
    const requested = (params.get('cars') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Held in a local, never read back off `spec` — an effect that reads the
    // state it also writes re-triggers itself, and `readBuildParams` allocates
    // a fresh object every run, so it would never settle.
    const fromUrl = readBuildParams(params);
    spec = fromUrl;
    const room = fromUrl ? MAX - 1 : MAX;
    const known = requested.filter((id) => cars.some((car) => car.id === id)).slice(0, room);
    if (known.length > 0) selected = known;
    picking = known.length === 0 && fromUrl === null;
  });

  interface Row {
    key: CompareRowKey;
    label: string;
    unit?: string;
    /** Which direction is "better", for highlighting. Absent = no winner. */
    better?: 'higher' | 'lower';
    decimals?: number;
    get: (car: CatalogueCar) => number | string | null;
  }

  /** Nothing about a build was produced or made by anyone, so those rows stay empty. */
  const notForBuild = <T,>(fn: (car: CatalogueCar) => T) => (car: CatalogueCar) =>
    car.id === BUILD_ID ? null : fn(car);

  const rows: Row[] = [
    { key: 'brand', label: 'Brand', get: notForBuild((c) => c.brandName) },
    {
      key: 'produced',
      label: 'Produced',
      get: notForBuild((c) =>
        c.yearEnd === null ? `${c.yearStart}–present` : `${c.yearStart}–${c.yearEnd}`,
      ),
    },
    { key: 'power', label: 'Power', unit: 'kW', better: 'higher', get: (c) => c.powerKwMax },
    { key: 'torque', label: 'Torque', unit: 'N⋅m', better: 'higher', get: (c) => c.torqueNmMax },
    { key: 'zero-to-hundred', label: '0–100 km/h', unit: 's', better: 'lower', decimals: 1, get: (c) => c.zeroToHundredMinS },
    { key: 'top-speed', label: 'Top speed', unit: 'km/h', better: 'higher', get: (c) => c.topSpeedMaxKmh },
    { key: 'consumption', label: 'Consumption', unit: 'L/100 km', better: 'lower', decimals: 1, get: (c) => c.consumptionMinL100km },
    { key: 'mass', label: 'Kerb weight', unit: 'kg', better: 'lower', get: (c) => c.massMinKg },
    { key: 'cd', label: 'Drag coefficient', better: 'lower', decimals: 2, get: (c) => c.dragCoefficientMin },
    { key: 'length', label: 'Length', unit: 'mm', get: (c) => c.lengthMm },
    { key: 'width', label: 'Width', unit: 'mm', get: (c) => c.widthMm },
    { key: 'height', label: 'Height', unit: 'mm', get: (c) => c.heightMm },
    { key: 'body', label: 'Body style', get: (c) => c.bodyStyles.join(', ') || null },
    { key: 'drivetrain', label: 'Drivetrain', get: (c) => c.drivetrains.join(', ') || null },
    { key: 'powertrain', label: 'Powertrain', get: (c) => c.powertrains.join(', ') || null },
  ];

  /**
   * True where a cell holds a figure the model produced rather than one anyone
   * published — which today is only ever the build's performance rows.
   */
  const isModelled = (row: Row, car: CatalogueCar) =>
    car.id === BUILD_ID && MODELLED_ROWS.includes(row.key);

  /**
   * The winning value for a row, or null when there is no meaningful winner.
   *
   * Deliberately returns null when fewer than two cars have the figure: a
   * "best" badge on the only car with data is not a comparison, it is a
   * statement about our research.
   */
  function bestValue(row: Row): number | null {
    if (!row.better) return null;
    const values = chosen
      // A modelled figure is excluded from the contest. A build "beating" a
      // manufacturer's published 0-100 would be a statement about the model's
      // ±20% band, not about the car, and a badge saying "best" would read as
      // the opposite.
      .filter((car) => !isModelled(row, car))
      .map((car) => row.get(car))
      .filter((v): v is number => typeof v === 'number');
    if (values.length < 2) return null;
    return row.better === 'higher' ? Math.max(...values) : Math.min(...values);
  }

  function render(row: Row, car: CatalogueCar): string {
    const raw = row.get(car);
    if (raw === null) return '—';
    if (typeof raw === 'string') return raw;
    const decimals = row.decimals ?? 0;
    const formatted = raw.toLocaleString('en-GB', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return row.unit ? `${formatted} ${row.unit}` : formatted;
  }
</script>

<div class="flex flex-col gap-6">
  <!-- Chosen cars -->
  <div class="flex flex-wrap items-center gap-2">
    {#each chosen as car (car.id)}
      <span
        class="inline-flex items-center gap-2 rounded-full border border-line bg-surface-1 py-1 pl-3 pr-1.5 text-sm"
        style={`--brand-accent: ${car.accentColor};`}
      >
        <span
          aria-hidden="true"
          class="size-2 rounded-full"
          style="background-color: var(--brand-accent);"
        ></span>
        <span class="max-w-[12rem] truncate">{car.name}</span>
        <button
          type="button"
          class="pressable inline-flex size-5 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
          onclick={() => remove(car.id)}
          aria-label={`Remove ${car.name} from the comparison`}
        >
          <span aria-hidden="true">×</span>
        </button>
      </span>
    {/each}

    <button
      type="button"
      class="pressable rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:border-line-strong disabled:opacity-40"
      onclick={() => (picking = !picking)}
      aria-expanded={picking}
      disabled={isFull && !picking}
    >
      {picking ? 'Done choosing' : `Add a car (${chosen.length}/${MAX})`}
    </button>

    <a
      href={build ? build.car.url : buildUrl}
      class="pressable rounded-full border border-dashed border-line px-3 py-1.5 text-sm text-ink-secondary transition-colors duration-150 hover:border-line-strong hover:text-ink"
    >
      {build ? 'Edit your build' : 'Build one instead'}
    </a>

    {#if chosen.length > 0}
      <button
        type="button"
        class="pressable rounded-full px-3 py-1.5 text-sm text-ink-muted transition-colors duration-150 hover:text-ink"
        onclick={clearAll}
      >
        Clear
      </button>
    {/if}
  </div>

  {#if picking}
    <fieldset class="rounded-lg border border-line bg-surface-1 p-4">
      <legend class="px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
        Choose up to {MAX}
      </legend>
      <ul class="mt-2 grid gap-1 sm:grid-cols-2">
        {#each cars as car (car.id)}
          {@const isSelected = selected.includes(car.id)}
          <li>
            <label
              class="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-surface-2"
              class:opacity-40={isFull && !isSelected}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={isFull && !isSelected}
                onchange={() => toggle(car.id)}
                class="size-3.5 shrink-0"
              />
              <span class="min-w-0 flex-1 truncate">
                {car.name}
                <span class="text-ink-muted">· {car.brandName}</span>
              </span>
            </label>
          </li>
        {/each}
      </ul>
    </fieldset>
  {/if}

  {#if chosen.length === 0}
    <div class="rounded-lg border border-dashed border-line bg-surface-1 p-8 text-center">
      <p class="text-sm text-ink-secondary">
        Pick two or more cars to compare them side by side.
      </p>
      <p class="mt-2 text-xs text-ink-muted">
        Your selection goes into this page's address, so you can bookmark a
        comparison or send it to someone. A car you
        <a class="underline decoration-line underline-offset-4 hover:text-ink" href={buildUrl}>
          built yourself
        </a>
        can take one of the four slots.
      </p>
    </div>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-line">
      <table class="type-data w-full border-collapse text-sm">
        <thead>
          <tr class="border-b border-line bg-surface-2">
            <th scope="col" class="sticky left-0 z-10 bg-surface-2 px-3 py-2.5 text-left font-medium">
              <span class="sr-only">Specification</span>
            </th>
            {#each chosen as car (car.id)}
              <th scope="col" class="min-w-[9rem] px-3 py-2.5 text-left font-medium">
                <a class="hover:underline" href={car.url}>{car.name}</a>
                <span class="block text-xs font-normal text-ink-muted">
                  {car.id === BUILD_ID ? 'Your build · not a real car' : car.brandName}
                </span>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.label)}
            {@const best = bestValue(row)}
            <tr class="border-b border-line last:border-b-0">
              <th
                scope="row"
                class="sticky left-0 z-10 whitespace-nowrap bg-surface-0 px-3 py-2 text-left font-normal text-ink-secondary"
              >
                {row.label}
              </th>
              {#each chosen as car (car.id)}
                {@const raw = row.get(car)}
                {@const modelled = isModelled(row, car)}
                {@const isBest = best !== null && raw === best && !modelled}
                <td
                  class="px-3 py-2 tabular-nums"
                  class:font-semibold={isBest}
                  class:text-ink-muted={raw === null}
                >
                  {render(row, car)}
                  {#if modelled && raw !== null}
                    <span class="ml-1 text-[0.625rem] uppercase tracking-wide text-status-estimated">
                      modelled
                    </span>
                  {/if}
                  {#if isBest}
                    <span class="ml-1 text-[0.625rem] uppercase tracking-wide text-status-verified">
                      best
                    </span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <p class="max-w-readable text-xs leading-relaxed text-ink-muted">
      An em dash means we do not have that figure yet — it is not a zero, and a
      car is never marked "best" on a row where it is the only one with data.
      Figures are the best available across each entry's trims.
      {#if build}
        A real car's performance figures are <strong class="text-ink-secondary"
          >published</strong
        >; your build's are <strong class="text-ink-secondary">modelled</strong>, so they
        are marked and never win a row — a model that lands within about 20% of a
        manufacturer's own claim cannot settle which car is quicker. Consumption is
        blank for a build on purpose: the model can only give steady-state use at
        a chosen speed, and a published figure is a drive cycle. The two are not
        the same measurement.
      {/if}
    </p>
  {/if}
</div>
