<script lang="ts">
  /**
   * Matchmaker — SPEC.md §9.3.
   *
   * The deeper of the two discovery tools: hard dealbreakers first, then
   * **weighted preference scoring within what survives**, producing a ranked,
   * percentage-matched list.
   *
   * It reuses the exact filter primitives Guided Browse uses — `matchmake()`
   * composes `applyDealbreakers` and `rankByPreference` rather than
   * reimplementing either — so the two tools can never disagree about what
   * qualifies. The only difference between them is that this one has an
   * opinion about the order.
   *
   * The percentage is explicitly *relative to the cars that survived your
   * dealbreakers*, not an absolute quality score. That distinction is stated in
   * the UI, because "94% match" invites being read as "94% good".
   */
  import { matchmake, type Candidate, type Preferences } from '../../lib/math/matchmaker.ts';
  import type { CatalogueCar } from '../../lib/content/catalogue.ts';

  interface VocabTerm {
    id: string;
    label: string;
  }

  interface Props {
    cars: CatalogueCar[];
    bodyStyleTerms: VocabTerm[];
    powertrainTerms: VocabTerm[];
  }

  let { cars, bodyStyleTerms, powertrainTerms }: Props = $props();

  const candidates: Candidate[] = cars.map((car) => ({
    id: car.id,
    label: car.name,
    bodyStyles: car.bodyStyles,
    powertrains: car.powertrains,
    drivetrains: car.drivetrains,
    segment: car.segment ?? undefined,
    positioning: car.positioning ?? undefined,
    eras: car.eras,
    price: car.priceMin,
    seats: null,
    consumptionPer100km: car.consumptionMinL100km,
    zeroToHundredSeconds: car.zeroToHundredMinS,
    powerToWeightKwPerTonne:
      car.powerKwMax !== null && car.massMinKg ? car.powerKwMax / (car.massMinKg / 1000) : null,
    bootLitres: null,
    productionStart: car.yearStart,
    productionEnd: car.yearEnd,
  }));

  const carsById = new Map(cars.map((c) => [c.id, c]));

  // --- dealbreakers ---
  let bodyStyles = $state<string[]>([]);
  let powertrains = $state<string[]>([]);
  let maxConsumption = $state<number | undefined>(undefined);

  // --- preferences, 0-3 ---
  let economy = $state(1);
  let performance = $state(1);
  let affordability = $state(0);

  const preferences = $derived<Preferences>({
    economy: economy / 3,
    performance: performance / 3,
    affordability: affordability / 3,
  });

  const result = $derived(
    matchmake(
      candidates,
      {
        bodyStyles: bodyStyles.length ? bodyStyles : undefined,
        powertrains: powertrains.length ? powertrains : undefined,
        maxConsumption,
      },
      preferences,
    ),
  );

  const anyPreference = $derived(economy + performance + affordability > 0);

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  const WEIGHT_LABELS = ['Not important', 'Slightly', 'Quite', 'Very important'];
</script>

<div class="grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr] lg:items-start">
  <div class="flex flex-col gap-4">
    <fieldset class="rounded-lg border border-line bg-surface-1 p-4">
      <legend class="px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
        Dealbreakers
      </legend>
      <p class="mt-1 text-xs leading-relaxed text-ink-muted">
        Hard filters. A car missing the data to prove it meets one of these is
        excluded rather than assumed to pass.
      </p>

      <p class="mt-3 text-sm font-medium">Body style</p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        {#each bodyStyleTerms as term (term.id)}
          <button
            type="button"
            class="pressable rounded-full border px-2.5 py-1 text-xs transition-colors duration-150"
            class:border-line-strong={bodyStyles.includes(term.id)}
            class:border-line={!bodyStyles.includes(term.id)}
            style={bodyStyles.includes(term.id) ? 'background-color: var(--color-surface-3);' : ''}
            aria-pressed={bodyStyles.includes(term.id)}
            onclick={() => (bodyStyles = toggle(bodyStyles, term.id))}
          >
            {term.label}
          </button>
        {/each}
      </div>

      <p class="mt-4 text-sm font-medium">Powertrain</p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        {#each powertrainTerms as term (term.id)}
          <button
            type="button"
            class="pressable rounded-full border px-2.5 py-1 text-xs transition-colors duration-150"
            class:border-line-strong={powertrains.includes(term.id)}
            class:border-line={!powertrains.includes(term.id)}
            style={powertrains.includes(term.id) ? 'background-color: var(--color-surface-3);' : ''}
            aria-pressed={powertrains.includes(term.id)}
            onclick={() => (powertrains = toggle(powertrains, term.id))}
          >
            {term.label}
          </button>
        {/each}
      </div>

      <label class="mt-4 block text-sm font-medium">
        Maximum consumption
        <select data-pagefind-ignore
          class="mt-1.5 w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-sm focus:border-line-strong focus:outline-none"
          value={maxConsumption ?? ''}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            maxConsumption = v === '' ? undefined : Number(v);
          }}
        >
          <option value="">No limit</option>
          <option value="5">Under 5 L/100 km</option>
          <option value="7">Under 7 L/100 km</option>
          <option value="10">Under 10 L/100 km</option>
        </select>
      </label>
    </fieldset>

    <fieldset class="rounded-lg border border-line bg-surface-1 p-4">
      <legend class="px-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
        Preferences
      </legend>
      <p class="mt-1 text-xs leading-relaxed text-ink-muted">
        These order the survivors; they never exclude anything.
      </p>

      {#each [{ key: 'economy', label: 'Running cost', get: () => economy, set: (v: number) => (economy = v) }, { key: 'performance', label: 'Performance', get: () => performance, set: (v: number) => (performance = v) }, { key: 'affordability', label: 'Purchase price', get: () => affordability, set: (v: number) => (affordability = v) }] as pref (pref.key)}
        <label class="mt-4 block">
          <span class="flex items-baseline justify-between gap-2 text-sm font-medium">
            {pref.label}
            <span class="text-xs font-normal text-ink-muted">{WEIGHT_LABELS[pref.get()]}</span>
          </span>
          <input
            type="range"
            min="0"
            max="3"
            step="1"
            value={pref.get()}
            oninput={(e) => pref.set(Number((e.currentTarget as HTMLInputElement).value))}
            class="mt-1.5 w-full accent-[var(--brand-accent)]"
          />
        </label>
      {/each}
    </fieldset>
  </div>

  <div class="min-w-0">
    {#if result.ranked.length === 0}
      <div class="rounded-lg border border-line bg-surface-1 p-6">
        <p class="text-sm">Nothing survives those dealbreakers.</p>
        {#if result.blocking.length > 0}
          <p class="mt-2 text-sm text-ink-secondary">
            The single condition ruling out the most cars is
            <strong class="text-ink">{result.blocking[0]!.constraint}</strong> —
            relaxing it alone would bring back {result.blocking[0]!.blocks}
            {result.blocking[0]!.blocks === 1 ? 'car' : 'cars'}.
          </p>
        {/if}
      </div>
    {:else}
      <p class="mb-3 text-sm text-ink-secondary" aria-live="polite">
        {result.ranked.length}
        {result.ranked.length === 1 ? 'car' : 'cars'} match your dealbreakers{anyPreference
          ? ', ranked by your preferences'
          : ''}.
      </p>

      <ol class="flex flex-col gap-2">
        {#each result.ranked as match, i (match.candidate.id)}
          {@const car = carsById.get(match.candidate.id)!}
          <li>
            <a
              href={car.url}
              class="pressable flex min-w-0 items-start gap-4 rounded-lg border border-line bg-surface-1 p-4 transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
              style={`--brand-accent: ${car.accentColor};`}
            >
              <span
                class="type-data mt-0.5 w-7 shrink-0 text-center text-sm tabular-nums text-ink-muted"
              >
                {i + 1}
              </span>

              <span class="min-w-0 flex-1">
                <span class="type-heading block truncate text-base">{car.name}</span>
                <span class="mt-0.5 block truncate text-xs text-ink-muted">
                  {car.brandName} · {car.yearStart}–{car.yearEnd ?? 'present'}
                </span>

                {#if anyPreference}
                  <span class="mt-2 flex items-center gap-2">
                    <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <span
                        class="block h-full rounded-full"
                        style={`width: ${match.matchPercent.toFixed(0)}%; background-color: var(--brand-accent);`}
                      ></span>
                    </span>
                    <span class="type-data shrink-0 text-xs tabular-nums text-ink-secondary">
                      {match.matchPercent.toFixed(0)}%
                    </span>
                  </span>

                  {#if match.unscored.length > 0}
                    <span class="mt-1 block text-xs text-ink-muted">
                      Not scored on {match.unscored.join(', ')} — we do not have that figure.
                    </span>
                  {/if}
                {/if}
              </span>
            </a>
          </li>
        {/each}
      </ol>

      {#if anyPreference}
        <p class="mt-4 max-w-prose text-xs leading-relaxed text-ink-muted">
          The percentage compares these cars <em>against each other</em> on the
          preferences you set — it is not a quality score, and a 100% does not
          mean a car is perfect. A car with no figure for one of your
          preferences is ranked on the rest and says so, rather than being
          scored zero for something we simply have not sourced.
        </p>
      {/if}
    {/if}
  </div>
</div>
