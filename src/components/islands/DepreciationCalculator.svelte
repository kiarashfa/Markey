<script lang="ts">
  /**
   * Depreciation projection.
   *
   * Calls `lib/math/depreciation.ts`, and shows the model's own `workings`
   * array rather than just its answer. That is deliberate: this is a projection
   * from a published formula, not market data, and a number shown without its
   * derivation invites being read as a valuation.
   *
   * The chart is a plain inline SVG. A charting library would be several times
   * the weight of the entire page for one monotonic curve.
   */
  import {
    DECAY_BY_POSITIONING,
    depreciate,
    depreciationCurve,
  } from '../../lib/math/depreciation.ts';

  let price = $state('30000');
  let age = $state('3');
  let positioning = $state('mainstream');
  let powertrain = $state('');
  let mileage = $state('');
  let currency = $state('');

  const n = (s: string) => {
    const v = Number.parseFloat(s);
    return Number.isFinite(v) ? v : null;
  };

  const inputs = $derived({
    purchasePrice: n(price) ?? 0,
    ageYears: n(age) ?? 0,
    positioning,
    powertrain: powertrain || undefined,
    mileageKm: n(mileage) ?? undefined,
  });

  const result = $derived(depreciate(inputs));
  const curve = $derived(depreciationCurve({ ...inputs, ageYears: 0 }, 15, 0.5));

  const money = (v: number) =>
    `${currency ? currency + ' ' : ''}${Math.round(v).toLocaleString('en-GB')}`;

  // --- chart geometry ---
  const W = 640;
  const H = 220;
  const PAD = { top: 12, right: 12, bottom: 26, left: 52 };

  const chart = $derived.by(() => {
    if (curve.length === 0) return null;
    const maxValue = Math.max(...curve.map((p) => p.value));
    const maxAge = Math.max(...curve.map((p) => p.ageYears));
    if (maxValue <= 0 || maxAge <= 0) return null;

    const x = (ageYears: number) =>
      PAD.left + (ageYears / maxAge) * (W - PAD.left - PAD.right);
    const y = (value: number) =>
      PAD.top + (1 - value / maxValue) * (H - PAD.top - PAD.bottom);

    const path = curve
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ageYears).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' ');

    const area = `${path} L${x(maxAge).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      value: maxValue * f,
      y: y(maxValue * f),
    }));

    const nowAge = Math.min(inputs.ageYears, maxAge);
    const nowPoint = result ? { x: x(nowAge), y: y(result.value) } : null;

    return { path, area, ticks, maxAge, x, y, nowPoint };
  });
</script>

<div class="flex flex-col gap-6">
  <div class="grid gap-4 sm:grid-cols-2">
    <label class="block">
      <span class="text-sm text-ink-secondary">Purchase price</span>
      <span class="mt-1.5 flex">
        <input
          type="number"
          bind:value={price}
          inputmode="numeric"
          step="500"
          class="type-data w-full rounded-l-lg border border-r-0 border-line bg-surface-1 px-3 py-2.5 tabular-nums focus:border-line-strong focus:outline-none"
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

    <label class="block">
      <span class="text-sm text-ink-secondary">Age in years</span>
      <input
        type="number"
        bind:value={age}
        inputmode="decimal"
        step="0.5"
        min="0"
        class="type-data mt-1.5 w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 tabular-nums focus:border-line-strong focus:outline-none"
      />
    </label>

    <label class="block">
      <span class="text-sm text-ink-secondary">Market tier</span>
      <select data-pagefind-ignore
        bind:value={positioning}
        class="mt-1.5 w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-sm focus:border-line-strong focus:outline-none"
      >
        {#each Object.entries(DECAY_BY_POSITIONING) as [id, decay] (id)}
          <option value={id}>
            {id.replace('-', ' ')}, {(decay.rate * 100).toFixed(0)}%/yr
          </option>
        {/each}
      </select>
    </label>

    <label class="block">
      <span class="text-sm text-ink-secondary">Powertrain</span>
      <select data-pagefind-ignore
        bind:value={powertrain}
        class="mt-1.5 w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-sm focus:border-line-strong focus:outline-none"
      >
        <option value="">Combustion (no adjustment)</option>
        <option value="phev">Plug-in hybrid (+1 point)</option>
        <option value="bev">Battery electric (+3 points)</option>
      </select>
    </label>

    <label class="block sm:col-span-2">
      <span class="text-sm text-ink-secondary">Odometer, km (optional)</span>
      <input
        type="number"
        bind:value={mileage}
        inputmode="numeric"
        step="1000"
        placeholder="leave blank to assume average use"
        class="type-data mt-1.5 w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 tabular-nums placeholder:text-xs placeholder:text-ink-muted focus:border-line-strong focus:outline-none"
      />
    </label>
  </div>

  {#if result && chart}
    <div class="rounded-lg border border-line bg-surface-1 p-5">
      <dl class="grid gap-4 sm:grid-cols-3">
        <div>
          <dt class="text-xs text-ink-muted">Projected value</dt>
          <dd class="type-data mt-1 text-2xl font-semibold tabular-nums">{money(result.value)}</dd>
        </div>
        <div>
          <dt class="text-xs text-ink-muted">Lost since new</dt>
          <dd class="type-data mt-1 text-2xl font-semibold tabular-nums">{money(result.lost)}</dd>
        </div>
        <div>
          <dt class="text-xs text-ink-muted">Retained</dt>
          <dd class="type-data mt-1 text-2xl font-semibold tabular-nums">
            {(result.retained * 100).toFixed(0)}%
          </dd>
        </div>
      </dl>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        class="mt-5 w-full"
        role="img"
        aria-label={`Projected value falling from ${money(inputs.purchasePrice)} when new to ${money(curve[curve.length - 1]?.value ?? 0)} at 15 years old.`}
      >
        {#each chart.ticks as tick (tick.value)}
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={tick.y}
            y2={tick.y}
            stroke="var(--color-line)"
            stroke-width="1"
          />
          <text
            x={PAD.left - 8}
            y={tick.y + 3}
            text-anchor="end"
            font-size="9"
            fill="var(--color-ink-muted)"
          >
            {Math.round(tick.value / 1000)}k
          </text>
        {/each}

        {#each [0, 5, 10, 15] as year (year)}
          <text
            x={chart.x(year)}
            y={H - 8}
            text-anchor="middle"
            font-size="9"
            fill="var(--color-ink-muted)"
          >
            {year}y
          </text>
        {/each}

        <path d={chart.area} fill="var(--brand-accent)" opacity="0.12" />
        <path d={chart.path} fill="none" stroke="var(--brand-accent)" stroke-width="2" />

        {#if chart.nowPoint}
          <circle cx={chart.nowPoint.x} cy={chart.nowPoint.y} r="4" fill="var(--brand-accent)" />
        {/if}
      </svg>

      <details class="mt-4">
        <summary class="cursor-pointer text-sm font-medium">Show the working</summary>
        <ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs text-ink-secondary">
          {#each result.workings as working (working)}
            <li>{working}</li>
          {/each}
        </ul>
      </details>
    </div>

    <p class="text-xs leading-relaxed text-ink-muted">
      <strong class="text-ink-secondary">This is a projection, not a valuation.</strong>
      It is a published formula applied to a purchase price. It has no
      knowledge of the used market, of this specific car, of its condition,
      history or desirability, and it will be wrong for any individual car.
      Treat it as a shape, not a price.
    </p>
  {:else}
    <p class="rounded-lg border border-dashed border-line bg-surface-1 p-5 text-sm text-ink-muted">
      Enter a purchase price and an age to see the projection.
    </p>
  {/if}
</div>
