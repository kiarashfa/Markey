<script lang="ts">
  /**
   * Fuel and energy cost calculator.
   *
   * Calls `lib/math/fuelCost.ts` directly, so this and any running-cost figure
   * elsewhere on the site are the same computation.
   *
   * **No regional price presets are shipped.** The site never invents data,
   * and a fuel price is the most perishable number the site could carry —
   * a plausible-looking default nobody sourced would be exactly the kind of
   * invented figure the whole project exists to avoid. The field starts empty
   * and the visitor types what they actually pay, which is more accurate than
   * any preset would have been anyway.
   */
  import { annualFuelCost, annualSaving, paybackYears } from '../../lib/math/fuelCost.ts';

  let consumption = $state('7.5');
  let price = $state('');
  let distance = $state('15000');
  let currency = $state('');

  // Comparison car, for the payback question people actually have.
  let compareConsumption = $state('');
  let comparePrice = $state('');

  const n = (s: string) => {
    const v = Number.parseFloat(s);
    return Number.isFinite(v) ? v : null;
  };

  const result = $derived.by(() => {
    const c = n(consumption);
    const p = n(price);
    const d = n(distance);
    if (c === null || p === null || d === null) return null;
    return annualFuelCost(c, p, d);
  });

  const comparison = $derived.by(() => {
    const c = n(compareConsumption);
    const p = n(comparePrice) ?? n(price);
    const d = n(distance);
    const base = n(consumption);
    const basePrice = n(price);
    if (c === null || p === null || d === null || base === null || basePrice === null) return null;

    const other = annualFuelCost(c, p, d);
    if (!other || !result) return null;

    const cheaperIsBase = result.cost <= other.cost;
    const saving = Math.abs(result.cost - other.cost);
    return {
      other,
      cheaperIsBase,
      saving,
      // Only meaningful when both use the same fuel at the same price.
      sameFuel: Math.abs(p - basePrice) < 1e-9,
    };
  });

  const money = (v: number) =>
    `${currency ? currency + ' ' : ''}${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
</script>

<div class="flex flex-col gap-6">
  <div class="grid gap-4 sm:grid-cols-2">
    <label class="block">
      <span class="text-sm text-ink-secondary">Consumption</span>
      <span class="mt-1.5 flex">
        <input
          type="number"
          bind:value={consumption}
          inputmode="decimal"
          step="0.1"
          class="type-data w-full rounded-l-lg border border-r-0 border-line bg-surface-1 px-3 py-2.5 tabular-nums focus:border-line-strong focus:outline-none"
        />
        <span class="inline-flex items-center rounded-r-lg border border-line bg-surface-2 px-3 text-xs text-ink-muted">
          L or kWh /100 km
        </span>
      </span>
    </label>

    <label class="block">
      <span class="text-sm text-ink-secondary">Price per litre or kWh</span>
      <span class="mt-1.5 flex">
        <input
          type="number"
          bind:value={price}
          inputmode="decimal"
          step="0.01"
          placeholder="what you actually pay"
          class="type-data w-full rounded-l-lg border border-r-0 border-line bg-surface-1 px-3 py-2.5 tabular-nums placeholder:text-xs placeholder:text-ink-muted focus:border-line-strong focus:outline-none"
        />
        <input
          type="text"
          bind:value={currency}
          placeholder="EUR"
          size="4"
          aria-label="Currency"
          class="w-20 rounded-r-lg border border-line bg-surface-2 px-3 py-2.5 text-xs uppercase focus:border-line-strong focus:outline-none"
        />
      </span>
    </label>

    <label class="block sm:col-span-2">
      <span class="text-sm text-ink-secondary">Distance per year</span>
      <span class="mt-1.5 flex">
        <input
          type="number"
          bind:value={distance}
          inputmode="numeric"
          step="500"
          class="type-data w-full rounded-l-lg border border-r-0 border-line bg-surface-1 px-3 py-2.5 tabular-nums focus:border-line-strong focus:outline-none"
        />
        <span class="inline-flex items-center rounded-r-lg border border-line bg-surface-2 px-3 text-xs text-ink-muted">
          km
        </span>
      </span>
    </label>
  </div>

  {#if result}
    <dl class="grid gap-4 rounded-lg border border-line bg-surface-1 p-5 sm:grid-cols-3">
      <div>
        <dt class="text-xs text-ink-muted">Per year</dt>
        <dd class="type-data mt-1 text-xl font-semibold tabular-nums">{money(result.cost)}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Per 100 km</dt>
        <dd class="type-data mt-1 text-xl font-semibold tabular-nums">{money(result.costPer100km)}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Fuel or energy used</dt>
        <dd class="type-data mt-1 text-xl font-semibold tabular-nums">
          {result.unitsUsed.toLocaleString('en-GB', { maximumFractionDigits: 0 })}
        </dd>
      </div>
    </dl>
  {:else}
    <p class="rounded-lg border border-dashed border-line bg-surface-1 p-5 text-sm text-ink-muted">
      Enter a price to see the cost. There is no default — fuel prices go stale
      within weeks and vary by country, region and even by forecourt, so the
      site would rather ask than guess.
    </p>
  {/if}

  <details class="rounded-lg border border-line bg-surface-1 p-4">
    <summary class="cursor-pointer text-sm font-medium">Compare against another car</summary>
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <label class="block">
        <span class="text-sm text-ink-secondary">Its consumption</span>
        <input
          type="number"
          bind:value={compareConsumption}
          inputmode="decimal"
          step="0.1"
          placeholder="e.g. 5.5"
          class="type-data mt-1.5 w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 tabular-nums focus:border-line-strong focus:outline-none"
        />
      </label>
      <label class="block">
        <span class="text-sm text-ink-secondary">Its fuel price (if different)</span>
        <input
          type="number"
          bind:value={comparePrice}
          inputmode="decimal"
          step="0.01"
          placeholder="same as above"
          class="type-data mt-1.5 w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 tabular-nums placeholder:text-xs focus:border-line-strong focus:outline-none"
        />
      </label>
    </div>

    {#if comparison}
      <div class="mt-4 rounded-lg border border-line bg-surface-2 p-4">
        <p class="text-sm">
          The second car costs
          <strong>{money(comparison.other.cost)}</strong> a year —
          {#if comparison.saving < 0.005}
            the same, to the penny.
          {:else}
            {comparison.cheaperIsBase ? 'more' : 'less'} by
            <strong>{money(comparison.saving)}</strong> a year.
          {/if}
        </p>
        {#if comparison.saving > 0}
          {@const payback = paybackYears(1000, comparison.saving)}
          <p class="mt-2 text-xs leading-relaxed text-ink-muted">
            At that rate every {money(1000)} of extra purchase price takes
            {payback === null ? '—' : payback.toFixed(1)} years to repay in fuel
            alone. This ignores depreciation, servicing, insurance, tax and
            interest — it is a fuel comparison, nothing more.
          </p>
        {/if}
      </div>
    {/if}
  </details>
</div>
