<script lang="ts">
  /**
   * Test Drive — the 2D instrumented panel.
   *
   * Every number here is computed in the browser by the *same* `lib/math`
   * functions the static pages use. That is the point of the shared engine: the
   * slider recomputes, and it cannot disagree with the spec sheet because it is
   * not a second implementation.
   *
   * Two honesty rules govern the whole panel:
   *
   *  1. **A modelled figure never replaces a published one.** Where both exist
   *     they sit side by side, each labelled, with the difference stated. That
   *     comparison is the interesting part — a car that misses its own claimed
   *     figure is telling you something about the model *or* the claim.
   *  2. **A missing input produces a gap, not a guess.** No Cd means no aero
   *     panel at all, with a plain explanation rather than an empty chart.
   */
  import { dragForce } from '../../lib/math/dynamics/aero.ts';
  import { brakingDistance100to0, stoppingDistance } from '../../lib/math/dynamics/braking.ts';
  import { consumptionAtSpeed, dragCrossoverSpeed } from '../../lib/math/dynamics/consumption.ts';
  import {
    accelerationTo,
    resistiveForce,
    topSpeedDetailed,
    zeroToHundred,
    type VehicleInputs,
  } from '../../lib/math/dynamics/performance.ts';
  import { drivetrainEfficiency } from '../../lib/math/dynamics/constants.ts';
  import { kmhToMs, powerToWeight } from '../../lib/math/units.ts';

  interface Published {
    zeroToHundredS: number | null;
    topSpeedKmh: number | null;
    consumptionL100km: number | null;
  }

  interface Props {
    inputs: VehicleInputs | null;
    published: Published;
    /** Why the model cannot run, when `inputs` is null. */
    missing: string[];
    frontalAreaEstimated: boolean;
    frontalAreaNote?: string;
    carName: string;
  }

  let { inputs, published, missing, frontalAreaEstimated, frontalAreaNote, carName }: Props =
    $props();

  let speed = $state(120);

  const top = $derived(inputs ? topSpeedDetailed(inputs) : null);
  const accel = $derived(inputs ? zeroToHundred(inputs) : null);
  const braking = $derived(inputs ? brakingDistance100to0(inputs.tyreGrip) : null);
  const ptw = $derived(inputs ? powerToWeight(inputs.powerKw, inputs.massKg) : null);
  const atSpeed = $derived(
    inputs
      ? consumptionAtSpeed(speed, {
          massKg: inputs.massKg,
          dragCoefficient: inputs.dragCoefficient,
          frontalAreaM2: inputs.frontalAreaM2,
          drivetrain: inputs.drivetrain,
          powertrain: inputs.powertrain ?? 'petrol',
        })
      : null,
  );
  const crossover = $derived(
    inputs
      ? dragCrossoverSpeed({
          massKg: inputs.massKg,
          dragCoefficient: inputs.dragCoefficient,
          frontalAreaM2: inputs.frontalAreaM2,
          drivetrain: inputs.drivetrain,
          powertrain: inputs.powertrain ?? 'petrol',
        })
      : null,
  );

  /** Speed-against-time, sampled from the same integrator that times 0–100. */
  const accelCurve = $derived.by(() => {
    if (!inputs) return null;
    const points: { t: number; v: number }[] = [];
    for (let v = 10; v <= 200; v += 10) {
      const result = accelerationTo(v, inputs);
      if (!result) break;
      points.push({ t: result.seconds, v });
    }
    return points.length > 2 ? points : null;
  });

  /**
   * Power required against speed, with the power available as a flat line.
   *
   * Where they cross *is* the top speed — the chart shows the solve rather than
   * asserting its answer, which is the whole reason to draw it.
   */
  const powerCurve = $derived.by(() => {
    if (!inputs || !top) return null;
    const maxKmh = Math.ceil((top.unrestrictedKmh + 40) / 20) * 20;
    const points: { kmh: number; kw: number }[] = [];
    for (let kmh = 20; kmh <= maxKmh; kmh += 5) {
      const ms = kmhToMs(kmh);
      points.push({ kmh, kw: (resistiveForce(ms, inputs) * ms) / 1000 });
    }
    const availableKw = inputs.powerKw * drivetrainEfficiency(inputs.drivetrain);
    return { points, availableKw, maxKmh };
  });

  const dragCurve = $derived.by(() => {
    if (!inputs) return null;
    const points: { kmh: number; n: number }[] = [];
    for (let kmh = 0; kmh <= 250; kmh += 10) {
      points.push({
        kmh,
        n: dragForce(kmhToMs(kmh), inputs.dragCoefficient, inputs.frontalAreaM2),
      });
    }
    return points;
  });

  const fmt = (v: number | null | undefined, digits = 0) =>
    v === null || v === undefined ? '·' : v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  /** Signed difference between a modelled and a published figure. */
  function delta(modelled: number | null, publishedValue: number | null) {
    if (modelled === null || publishedValue === null || publishedValue === 0) return null;
    const percent = ((modelled - publishedValue) / publishedValue) * 100;
    return { percent, faster: percent > 0 };
  }

  const W = 620;
  const H = 170;
  const PAD = { t: 10, r: 12, b: 26, l: 46 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
</script>

{#if !inputs}
  <div class="rounded-lg border border-dashed border-line bg-surface-1 p-6">
    <h2 class="type-heading text-base">No instrumented readout for this car yet</h2>
    <p class="mt-2 text-sm text-ink-secondary">
      The physics needs figures we have not sourced for {carName} yet. Rather
      than fill the gaps with plausible numbers and present the result as a
      measurement, there is no panel.
    </p>
    <p class="mt-3 text-sm">
      <span class="text-ink-secondary">Missing:</span>
      <span class="font-medium">{missing.join(', ')}</span>
    </p>
  </div>
{:else}
  <div class="flex flex-col gap-6">
    <!-- Headline: modelled against published -->
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {#each [{ label: '0–100 km/h', modelled: accel?.seconds ?? null, publishedValue: published.zeroToHundredS, unit: 's', digits: 1, lowerIsBetter: true }, { label: 'Top speed', modelled: top?.kmh ?? null, publishedValue: published.topSpeedKmh, unit: 'km/h', digits: 0, lowerIsBetter: false }] as row (row.label)}
        {@const d = delta(row.modelled, row.publishedValue)}
        <div class="rounded-lg border border-line bg-surface-1 p-4">
          <p class="text-xs uppercase tracking-wide text-ink-muted">{row.label}</p>
          <div class="mt-2 flex items-baseline gap-2">
            <span class="type-data text-2xl font-semibold tabular-nums">{fmt(row.modelled, row.digits)}</span>
            <span class="text-sm text-ink-muted">{row.unit}</span>
          </div>
          <p class="mt-0.5 text-[0.6875rem] uppercase tracking-wide text-ink-muted">modelled</p>

          {#if row.publishedValue !== null}
            <div class="mt-3 border-t border-line pt-2">
              <div class="flex items-baseline gap-2">
                <span class="type-data text-lg font-medium tabular-nums">{fmt(row.publishedValue, row.digits)}</span>
                <span class="text-xs text-ink-muted">{row.unit}</span>
              </div>
              <p class="text-[0.6875rem] uppercase tracking-wide text-ink-muted">published</p>
              {#if d}
                <p class="mt-1 text-xs text-ink-secondary">
                  Model is {Math.abs(d.percent).toFixed(0)}%
                  {d.faster ? 'higher' : 'lower'}
                </p>
              {/if}
            </div>
          {:else}
            <p class="mt-3 border-t border-line pt-2 text-xs text-ink-muted">
              No published figure to compare against.
            </p>
          {/if}
        </div>
      {/each}

      <div class="rounded-lg border border-line bg-surface-1 p-4">
        <p class="text-xs uppercase tracking-wide text-ink-muted">Braking 100–0</p>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="type-data text-2xl font-semibold tabular-nums">{fmt(braking, 1)}</span>
          <span class="text-sm text-ink-muted">m</span>
        </div>
        <p class="mt-0.5 text-[0.6875rem] uppercase tracking-wide text-ink-muted">modelled</p>
        <p class="mt-3 border-t border-line pt-2 text-xs leading-relaxed text-ink-muted">
          Tyre-limited ideal. Ignores fade and assumes peak grip throughout. A
          floor, not a test result.
        </p>
      </div>

      <div class="rounded-lg border border-line bg-surface-1 p-4">
        <p class="text-xs uppercase tracking-wide text-ink-muted">Power to weight</p>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="type-data text-2xl font-semibold tabular-nums">{fmt(ptw, 0)}</span>
          <span class="text-sm text-ink-muted">kW/t</span>
        </div>
        <p class="mt-0.5 text-[0.6875rem] uppercase tracking-wide text-ink-muted">at kerb weight</p>
        {#if accel && !accel.powerLimitedThroughout}
          <p class="mt-3 border-t border-line pt-2 text-xs leading-relaxed text-ink-muted">
            Traction-limited to {fmt(accel.tractionLimitedToKmh, 0)} km/h: grip,
            not power, sets the launch.
          </p>
        {/if}
      </div>
    </div>

    {#if top?.limited}
      <p class="rounded-lg border border-status-estimated/40 bg-status-estimated/10 p-3 text-sm">
        Electronically limited to {fmt(top.kmh, 0)} km/h. Unrestricted, power and
        drag would balance at about {fmt(top.unrestrictedKmh, 0)} km/h.
      </p>
    {/if}

    <!--
      The gap the methodology page names as this model's largest, closed for
      anything that supplies gearing: a car geared out below its aerodynamic
      ceiling never reaches it, however much power is left.
    -->
    {#if top?.gearLimited}
      <p class="rounded-lg border border-status-estimated/40 bg-status-estimated/10 p-3 text-sm">
        Geared out at {fmt(top.kmh, 0)} km/h: the engine reaches its limit in
        top gear before the car reaches the {fmt(top.unrestrictedKmh, 0)} km/h at
        which power and drag would balance. Power is not what stops this car.
      </p>
    {/if}

    <!-- Acceleration -->
    {#if accelCurve}
      {@const maxT = Math.max(...accelCurve.map((p) => p.t))}
      {@const maxV = Math.max(...accelCurve.map((p) => p.v))}
      <section class="rounded-lg border border-line bg-surface-1 p-5">
        <h3 class="type-heading text-sm">Acceleration</h3>
        <p class="mt-1 text-xs text-ink-secondary">
          Speed against time, integrated forward: traction-limited off the line,
          then power-limited.
        </p>
        <svg viewBox={`0 0 ${W} ${H}`} class="mt-3 w-full" role="img" aria-label={`Speed rising to ${fmt(maxV)} km/h over ${fmt(maxT, 1)} seconds.`}>
          {#each [0, 0.25, 0.5, 0.75, 1] as f (f)}
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * plotH} y2={PAD.t + f * plotH} stroke="var(--color-line)" />
            <text x={PAD.l - 6} y={PAD.t + f * plotH + 3} text-anchor="end" font-size="9" fill="var(--color-ink-muted)">
              {Math.round(maxV * (1 - f))}
            </text>
          {/each}
          <path
            d={accelCurve.map((p, i) => `${i === 0 ? 'M' : 'L'}${(PAD.l + (p.t / maxT) * plotW).toFixed(1)},${(PAD.t + (1 - p.v / maxV) * plotH).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--brand-accent)"
            stroke-width="2"
          />
          {#each [0, 0.5, 1] as f (f)}
            <text x={PAD.l + f * plotW} y={H - 8} text-anchor="middle" font-size="9" fill="var(--color-ink-muted)">
              {(maxT * f).toFixed(1)}s
            </text>
          {/each}
        </svg>
      </section>
    {/if}

    <!-- Power required vs available: the top-speed solve, drawn -->
    {#if powerCurve}
      {@const maxKw = Math.max(powerCurve.availableKw * 1.35, ...powerCurve.points.map((p) => p.kw))}
      <section class="rounded-lg border border-line bg-surface-1 p-5">
        <h3 class="type-heading text-sm">Power required against speed</h3>
        <p class="mt-1 text-xs text-ink-secondary">
          Where the curve meets the flat line is the top speed. Drag rises with
          the cube of speed, which is why the last 20 km/h cost more than the
          first 100.
        </p>
        <svg viewBox={`0 0 ${W} ${H}`} class="mt-3 w-full" role="img" aria-label={`Power required rising steeply with speed, crossing the available ${fmt(powerCurve.availableKw)} kW at about ${fmt(top?.unrestrictedKmh ?? null)} km/h.`}>
          {#each [0, 0.25, 0.5, 0.75, 1] as f (f)}
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * plotH} y2={PAD.t + f * plotH} stroke="var(--color-line)" />
            <text x={PAD.l - 6} y={PAD.t + f * plotH + 3} text-anchor="end" font-size="9" fill="var(--color-ink-muted)">
              {Math.round(maxKw * (1 - f))}
            </text>
          {/each}
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + (1 - powerCurve.availableKw / maxKw) * plotH}
            y2={PAD.t + (1 - powerCurve.availableKw / maxKw) * plotH}
            stroke="var(--color-status-verified)"
            stroke-width="1.5"
            stroke-dasharray="4 3"
          />
          <path
            d={powerCurve.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${(PAD.l + (p.kmh / powerCurve.maxKmh) * plotW).toFixed(1)},${(PAD.t + (1 - p.kw / maxKw) * plotH).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--brand-accent)"
            stroke-width="2"
          />
          {#each [0, 0.5, 1] as f (f)}
            <text x={PAD.l + f * plotW} y={H - 8} text-anchor="middle" font-size="9" fill="var(--color-ink-muted)">
              {Math.round(powerCurve.maxKmh * f)}
            </text>
          {/each}
        </svg>
        <p class="mt-1 text-xs text-ink-muted">
          Dashed line: {fmt(powerCurve.availableKw)} kW at the wheels, after
          drivetrain losses. Horizontal axis in km/h.
        </p>
      </section>
    {/if}

    <!-- Interactive: energy at a chosen cruising speed -->
    <section class="rounded-lg border border-line bg-surface-1 p-5">
      <h3 class="type-heading text-sm">Holding a steady speed</h3>
      <label class="mt-3 block">
        <span class="flex items-baseline justify-between text-xs text-ink-secondary">
          <span>Cruising speed</span>
          <span class="type-data font-medium tabular-nums text-ink">{speed} km/h</span>
        </span>
        <input type="range" min="30" max="200" step="5" bind:value={speed} class="mt-1.5 w-full accent-[var(--brand-accent)]" />
      </label>

      {#if atSpeed}
        <dl class="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt class="text-xs text-ink-muted">Power at the wheels</dt>
            <dd class="type-data mt-0.5 text-lg font-semibold tabular-nums">{fmt(atSpeed.wheelPowerKw, 1)} kW</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Spent on drag</dt>
            <dd class="type-data mt-0.5 text-lg font-semibold tabular-nums">{(atSpeed.dragShare * 100).toFixed(0)}%</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Steady-state use</dt>
            <dd class="type-data mt-0.5 text-lg font-semibold tabular-nums">
              {atSpeed.litresPer100km !== null
                ? `${fmt(atSpeed.litresPer100km, 1)} L/100 km`
                : `${fmt(atSpeed.kwhPer100km, 1)} kWh/100 km`}
            </dd>
          </div>
        </dl>

        {#if published.consumptionL100km !== null && atSpeed.litresPer100km !== null}
          <p class="mt-3 text-xs leading-relaxed text-ink-muted">
            The published figure of {fmt(published.consumptionL100km, 1)} L/100 km
            is a drive cycle, with stops, acceleration and hills. This is a constant
            speed on level ground, so the two are not comparable and neither is
            wrong.
          </p>
        {:else}
          <p class="mt-3 text-xs leading-relaxed text-ink-muted">
            A constant speed on level ground, not a drive cycle. Not comparable
            with a WLTP or EPA figure.
          </p>
        {/if}

        {#if crossover}
          <p class="mt-2 text-xs leading-relaxed text-ink-muted">
            Below about {fmt(crossover, 0)} km/h rolling resistance dominates;
            above it, drag does.
          </p>
        {/if}
      {/if}
    </section>

    <!-- Drag -->
    {#if dragCurve}
      {@const maxN = Math.max(...dragCurve.map((p) => p.n))}
      <section class="rounded-lg border border-line bg-surface-1 p-5">
        <h3 class="type-heading text-sm">Aerodynamic drag</h3>
        <p class="mt-1 text-xs text-ink-secondary">
          Cd {inputs.dragCoefficient.toFixed(2)} × {inputs.frontalAreaM2.toFixed(2)} m²
          = CdA {(inputs.dragCoefficient * inputs.frontalAreaM2).toFixed(3)} m².
          {#if frontalAreaEstimated}
            <span class="text-status-estimated">Frontal area estimated.</span>
          {/if}
        </p>
        <svg viewBox={`0 0 ${W} ${H}`} class="mt-3 w-full" role="img" aria-label={`Drag force rising with the square of speed to ${fmt(maxN)} newtons at 250 km/h.`}>
          {#each [0, 0.5, 1] as f (f)}
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * plotH} y2={PAD.t + f * plotH} stroke="var(--color-line)" />
            <text x={PAD.l - 6} y={PAD.t + f * plotH + 3} text-anchor="end" font-size="9" fill="var(--color-ink-muted)">
              {Math.round(maxN * (1 - f))}
            </text>
          {/each}
          <path
            d={`${dragCurve.map((p, i) => `${i === 0 ? 'M' : 'L'}${(PAD.l + (p.kmh / 250) * plotW).toFixed(1)},${(PAD.t + (1 - p.n / maxN) * plotH).toFixed(1)}`).join(' ')} L${(PAD.l + plotW).toFixed(1)},${(PAD.t + plotH).toFixed(1)} L${PAD.l},${(PAD.t + plotH).toFixed(1)} Z`}
            fill="var(--brand-accent)"
            opacity="0.12"
          />
          <path
            d={dragCurve.map((p, i) => `${i === 0 ? 'M' : 'L'}${(PAD.l + (p.kmh / 250) * plotW).toFixed(1)},${(PAD.t + (1 - p.n / maxN) * plotH).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--brand-accent)"
            stroke-width="2"
          />
          {#each [0, 0.5, 1] as f (f)}
            <text x={PAD.l + f * plotW} y={H - 8} text-anchor="middle" font-size="9" fill="var(--color-ink-muted)">
              {Math.round(250 * f)}
            </text>
          {/each}
        </svg>
        <p class="mt-1 text-xs text-ink-muted">Newtons against km/h.</p>
        {#if frontalAreaNote}
          <p class="mt-2 text-xs leading-relaxed text-ink-muted">{frontalAreaNote}</p>
        {/if}
      </section>
    {/if}

    <p class="text-xs leading-relaxed text-ink-muted">
      Every figure on this page is <strong class="text-ink-secondary">modelled</strong>,
      not measured. The formulae and every default constant are published on the
      methodology page, including where the model is weakest: it knows nothing
      about gearing, so a car that runs out of gears before it runs out of power
      will model faster than it really is.
    </p>
  </div>
{/if}
