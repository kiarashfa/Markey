<script lang="ts">
  /**
   * Build Car — SPEC.md §9.6.
   *
   * Spec a car that does not exist and run it through the **same** physics the
   * catalogue's cars run through. Three things make that claim true rather than
   * decorative:
   *
   *  1. The form produces a `BuildSpec`, `toVehicleInputs` turns it into the
   *     identical `VehicleInputs` `lib/content/testDrive.ts` builds for a real
   *     car, and `build.test.ts` asserts the two agree figure for figure.
   *  2. The readout **is** the Test Drive panel — the same component, same
   *     charts, same integrator. Not a lookalike.
   *  3. Nothing is stored. The build lives in the address bar, so sharing it is
   *     copying the link and there is no second copy to fall out of date.
   *
   * The honesty rules are the same ones the rest of the site runs on. A preset
   * is a starting point for a hypothetical, never a claim about a real car, and
   * it says so. A missing input produces a gap and a plain explanation of what
   * to fill in, never a defaulted number dressed up as a result.
   */
  import OptionCards, { type Option } from './OptionCards.svelte';
  import TestDrive2D from './TestDrive2D.svelte';
  import WindTunnel from './WindTunnel.svelte';
  import {
    SEGMENT_PRESETS,
    TORQUE_NOTE,
    defaultSpec,
    missingInputs,
    presetById,
    resolveBuildArea,
    specFromPreset,
    toVehicleInputs,
    type BuildSpec,
  } from '../../lib/build/spec.ts';
  import { clearBuildParams, encodeBuild, readBuildParams } from '../../lib/build/url.ts';
  import { gearedTopSpeed, rpmAtSpeed } from '../../lib/math/dynamics/gearing.ts';
  import { dragArea } from '../../lib/math/dynamics/aero.ts';

  interface Props {
    /** `/compare/`, so a build can be sent straight into the comparison. */
    compareUrl: string;
    /** Body-style ids from the taxonomy, for the shape the tunnel would run. */
    bodyStyles: { id: string; label: string }[];
    drivetrains: { id: string; label: string }[];
    powertrains: { id: string; label: string }[];
  }

  let { compareUrl, bodyStyles, drivetrains, powertrains }: Props = $props();

  let spec = $state<BuildSpec>(defaultSpec());
  let hydrated = $state(false);
  let copied = $state(false);
  /** Set when the solver's figures were applied, so the readout can say so. */
  let solverApplied = $state<{ cd: number; areaM2: number } | null>(null);

  const preset = $derived(spec.segment ? presetById(spec.segment) : undefined);

  /**
   * The presets as choosable cards.
   *
   * A row of capsules made every class look identical and told the visitor
   * nothing about what pressing one would do. The three numbers that actually
   * separate these classes — mass, power and drag — are on the card, so the
   * choice is visible before it is made and the difference between a compact
   * and a full-size SUV is a fact rather than a word.
   */
  const presetOptions = $derived<Option[]>(
    SEGMENT_PRESETS.map((option) => ({
      id: option.id,
      label: option.label,
      meta: `${option.spec.massKg} kg · ${option.spec.powerKw} kW · Cd ${option.spec.dragCoefficient}`,
      detail: option.basis,
    })),
  );
  const missing = $derived(missingInputs(spec));
  const inputs = $derived(toVehicleInputs(spec));
  const area = $derived(resolveBuildArea(spec));
  const geared = $derived(
    gearedTopSpeed(
      spec.kmhPer1000rpm > 0 && spec.redlineRpm > 0
        ? { kmhPer1000rpm: spec.kmhPer1000rpm, redlineRpm: spec.redlineRpm }
        : undefined,
    ),
  );
  const cruiseRpm = $derived(
    rpmAtSpeed(
      spec.kmhPer1000rpm > 0 ? { kmhPer1000rpm: spec.kmhPer1000rpm, redlineRpm: 0 } : undefined,
      120,
    ),
  );

  /** No published figures exist for a car nobody built. */
  const published = { zeroToHundredS: null, topSpeedKmh: null, consumptionL100km: null };

  const query = $derived(encodeBuild(spec));
  const compareHref = $derived(`${compareUrl}?${query}`);

  // --- URL state -----------------------------------------------------------
  // Read once on mount. A link someone was sent wins over the default preset.
  $effect(() => {
    const fromUrl = readBuildParams(new URLSearchParams(window.location.search));
    if (fromUrl) spec = fromUrl;
    hydrated = true;
  });

  // Write on every change. `replaceState`, not `pushState`: a history entry per
  // keystroke would bury the page the visitor arrived from.
  $effect(() => {
    const encoded = query;
    if (!hydrated) return;
    const url = new URL(window.location.href);
    clearBuildParams(url.searchParams);
    for (const [key, value] of new URLSearchParams(encoded)) url.searchParams.set(key, value);
    window.history.replaceState({}, '', url);
  });

  function applyPreset(id: string) {
    const found = presetById(id);
    if (found) {
      spec = specFromPreset(found);
      solverApplied = null;
    }
  }

  /**
   * The wind tunnel's answer, applied to the build (SPEC.md §9.6, the closed
   * loop). Both figures move together because they are one measurement of one
   * shape — taking the Cd and leaving the area would mix a measured coefficient
   * with an estimated area and quietly change what the drag figure means.
   */
  function applySolver(cd: number, areaM2: number) {
    spec.dragCoefficient = Math.round(cd * 1000) / 1000;
    spec.frontalAreaM2 = Math.round(areaM2 * 1000) / 1000;
    spec.segment = '';
    solverApplied = { cd: spec.dragCoefficient, areaM2: spec.frontalAreaM2 };
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard access can simply be refused. The address bar already holds
      // the link, so there is nothing to recover from and nothing to apologise
      // for beyond saying the button did not work.
      copied = false;
    }
  }

  const num = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  const fmt = (value: number | null, digits = 0) =>
    value === null
      ? '—'
      : value.toLocaleString('en-GB', {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });

  const INPUT_CLASS =
    'type-data w-full rounded-l-lg border border-r-0 border-line bg-surface-1 px-3 py-2.5 tabular-nums focus:border-line-strong focus:outline-none';
  const UNIT_CLASS =
    'inline-flex shrink-0 items-center rounded-r-lg border border-line bg-surface-2 px-2.5 text-xs text-ink-muted';
  /**
   * `data-pagefind-ignore` on every `<select>`.
   *
   * The island renders server-side, so its `<option>` text is in the HTML that
   * Pagefind indexes — and Pagefind joins adjacent inline text with nothing
   * between it, which turned this form's three dropdowns into the single token
   * "SaloonHatchbackLiftbackEstateCoupé…" in the index. It matched nothing
   * anyone would search for and overflowed the result card when it did.
   * A control's vocabulary is not the page's content.
   */
  const SELECT_CLASS =
    'mt-1.5 w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-sm focus:border-line-strong focus:outline-none';
</script>

{#snippet field(
  label: string,
  unit: string,
  value: number,
  set: (v: number) => void,
  step: number,
  hint?: string,
)}
  <label class="block min-w-0">
    <span class="flex items-baseline justify-between gap-2 text-sm text-ink-secondary">
      <span>{label}</span>
      {#if hint}<span class="truncate text-xs text-ink-muted">{hint}</span>{/if}
    </span>
    <span class="mt-1.5 flex">
      <input
        type="number"
        inputmode="decimal"
        min="0"
        {step}
        value={value === 0 ? '' : value}
        placeholder="—"
        oninput={(event) => set(num(event.currentTarget.value))}
        class={INPUT_CLASS}
      />
      <span class={UNIT_CLASS}>{unit}</span>
    </span>
  </label>
{/snippet}

<div class="flex flex-col gap-8">
  <!-- Start from something plausible -------------------------------------- -->
  <section class="rounded-lg border border-line bg-surface-1 p-5">
    <h2 class="type-heading text-sm">Start from</h2>
    <p class="mt-1.5 max-w-readable text-xs leading-relaxed text-ink-muted">
      Starting positions for a car you are inventing, not figures about a car
      anyone built. Nothing here is sourced and nothing here is meant to be —
      pick the nearest one and change all of it.
      {#if !preset}
        <span class="text-ink-secondary">
          This build has drifted away from every preset, which is the point.
        </span>
      {/if}
    </p>

    <div class="mt-4">
      <OptionCards
        label="Starting point"
        multiple={false}
        columns={3}
        options={presetOptions}
        selected={spec.segment ? [spec.segment] : []}
        onToggle={applyPreset}
      />
    </div>
  </section>

  <!-- The specification ----------------------------------------------------- -->
  <section class="grid gap-6 lg:grid-cols-2">
    <div class="rounded-lg border border-line bg-surface-1 p-5">
      <h2 class="type-heading text-sm">Engine and mass</h2>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <label class="block min-w-0 sm:col-span-2">
          <span class="text-sm text-ink-secondary">Name</span>
          <input
            type="text"
            maxlength="60"
            value={spec.name}
            placeholder="Your build"
            oninput={(event) => (spec.name = event.currentTarget.value)}
            class="mt-1.5 w-full rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-sm focus:border-line-strong focus:outline-none"
          />
        </label>

        {@render field('Kerb mass', 'kg', spec.massKg, (v) => (spec.massKg = v), 10)}
        {@render field('Power', 'kW', spec.powerKw, (v) => (spec.powerKw = v), 5)}
        {@render field('Torque', 'N⋅m', spec.torqueNm, (v) => (spec.torqueNm = v), 10)}
        {@render field(
          'Speed limiter',
          'km/h',
          spec.speedLimiterKmh,
          (v) => (spec.speedLimiterKmh = v),
          5,
          'blank if none',
        )}

        <label class="block min-w-0">
          <span class="text-sm text-ink-secondary">Drivetrain</span>
          <select data-pagefind-ignore bind:value={spec.drivetrain} class={SELECT_CLASS}>
            {#each drivetrains as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        </label>

        <label class="block min-w-0">
          <span class="text-sm text-ink-secondary">Powertrain</span>
          <select data-pagefind-ignore bind:value={spec.powertrain} class={SELECT_CLASS}>
            {#each powertrains as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        </label>
      </div>

      <p class="mt-4 max-w-readable text-xs leading-relaxed text-ink-muted">{TORQUE_NOTE}</p>
    </div>

    <div class="rounded-lg border border-line bg-surface-1 p-5">
      <h2 class="type-heading text-sm">Body, aerodynamics and grip</h2>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        {@render field(
          'Drag coefficient',
          'Cd',
          spec.dragCoefficient,
          (v) => {
            spec.dragCoefficient = v;
            solverApplied = null;
          },
          0.01,
        )}
        {@render field(
          'Frontal area',
          'm²',
          spec.frontalAreaM2,
          (v) => {
            spec.frontalAreaM2 = v;
            solverApplied = null;
          },
          0.05,
          'blank to estimate',
        )}
        {@render field('Length', 'mm', spec.lengthMm, (v) => (spec.lengthMm = v), 10)}
        {@render field('Width', 'mm', spec.widthMm, (v) => (spec.widthMm = v), 10)}
        {@render field('Height', 'mm', spec.heightMm, (v) => (spec.heightMm = v), 10)}
        {@render field('Tyre grip', 'μ', spec.tyreGrip, (v) => (spec.tyreGrip = v), 0.05)}

        <label class="block min-w-0 sm:col-span-2">
          <span class="text-sm text-ink-secondary">Body style</span>
          <select data-pagefind-ignore bind:value={spec.bodyStyle} class={SELECT_CLASS}>
            {#each bodyStyles as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        </label>
      </div>

      <p class="mt-4 max-w-readable text-xs leading-relaxed text-ink-muted">
        {#if solverApplied}
          <span class="text-status-estimated">From the wind tunnel:</span>
          Cd {solverApplied.cd.toFixed(3)} over {solverApplied.areaM2.toFixed(2)} m², measured
          on the shape below rather than typed. Both figures came from one run, and
          editing either by hand replaces it with your own.
        {:else if area?.estimated}
          Frontal area estimated at {area.value.toFixed(2)} m² from width × height.
          {area.note}
        {:else if area}
          Frontal area {area.value.toFixed(2)} m², as given.
          CdA {dragArea(spec.dragCoefficient, area.value).toFixed(3)} m² — the product
          that actually sets drag, and the reason a low Cd on a large car is not
          the win it sounds like.
        {:else}
          Give it a width and a height, or a frontal area outright. Without one
          of the two there is no drag figure and no model.
        {/if}
      </p>
    </div>
  </section>

  <!-- Gearing --------------------------------------------------------------- -->
  <section class="rounded-lg border border-line bg-surface-1 p-5">
    <h2 class="type-heading text-sm">Gearing</h2>
    <p class="mt-1 max-w-readable text-xs leading-relaxed text-ink-secondary">
      Road speed at 1000 rpm in top gear, and the engine speed the run ends at.
      One number each, both readable off a tachometer — which is why the model
      asks for these rather than for a ratio, a final drive and a tyre size.
      Leave them blank and the top speed is purely where power meets drag, which
      is what every car in the catalogue gets.
    </p>
    <div class="mt-4 grid gap-4 sm:grid-cols-3">
      {@render field(
        'Speed per 1000 rpm',
        'km/h',
        spec.kmhPer1000rpm,
        (v) => (spec.kmhPer1000rpm = v),
        1,
        'in top gear',
      )}
      {@render field('Redline', 'rpm', spec.redlineRpm, (v) => (spec.redlineRpm = v), 100)}
      <div class="rounded-lg border border-line bg-surface-2 p-3">
        <p class="text-xs text-ink-muted">Geared for</p>
        <p class="type-data mt-1 text-lg font-semibold tabular-nums">
          {fmt(geared, 0)}<span class="ml-1 text-sm font-normal text-ink-muted">km/h</span>
        </p>
        {#if cruiseRpm !== null && cruiseRpm > 0}
          <p class="mt-1 text-xs leading-relaxed text-ink-muted">
            {fmt(cruiseRpm, 0)} rpm at 120 km/h.
          </p>
        {/if}
      </div>
    </div>
  </section>

  <!-- The shape, and the tunnel that measures it ---------------------------- -->
  <!--
    SPEC.md §9.6's closed loop: the numbers above describe a car, the dimensions
    above describe a body, and this is where the two meet. The tunnel is the
    same component the Test Drive page runs, in its `build` variant — the solver
    still sits behind a dynamic `import()` and still starts only when asked, so
    a visitor who never opens it never pays for it.
  -->
  <section class="rounded-lg border border-line bg-surface-1 p-5">
    <h2 class="type-heading text-sm">Measure the shape</h2>
    <p class="mt-1 max-w-readable text-xs leading-relaxed text-ink-secondary">
      The dimensions above are a body, and the wind tunnel will run it and
      report what it measures. Send that back into the build and every figure
      below recomputes from a Cd nobody typed — a lower roof, a tighter wake, a
      higher top speed, each step computed rather than asserted. Set the
      dimensions first: the shape is built when the solver starts, and changing
      them afterwards means building it again.
    </p>
    <div class="mt-4">
      <WindTunnel
        variant="build"
        carName={spec.name || 'your build'}
        bodyStyles={spec.bodyStyle ? [spec.bodyStyle] : []}
        lengthM={spec.lengthMm > 0 ? spec.lengthMm / 1000 : null}
        widthM={spec.widthMm > 0 ? spec.widthMm / 1000 : null}
        heightM={spec.heightMm > 0 ? spec.heightMm / 1000 : null}
        publishedCd={spec.dragCoefficient > 0 ? spec.dragCoefficient : null}
        onMeasure={applySolver}
      />
    </div>
  </section>

  <!-- The readout ----------------------------------------------------------- -->
  <section>
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <h2 class="type-heading text-base">{spec.name || 'Your build'}, modelled</h2>
      <div class="flex flex-wrap items-center gap-2">
        <a
          href={compareHref}
          class="pressable rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:border-line-strong"
        >
          Compare against real cars
        </a>
        <button
          type="button"
          onclick={copyLink}
          class="pressable rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:border-line-strong"
        >
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
    </div>

    <p class="mt-2 max-w-readable text-xs leading-relaxed text-ink-muted">
      This build is written into the page's address as you type. Nothing is
      saved anywhere, so the link is the only copy — and it is enough.
    </p>

    <div class="mt-5">
      {#if inputs}
        <TestDrive2D
          {inputs}
          {published}
          missing={[]}
          frontalAreaEstimated={area?.estimated ?? false}
          frontalAreaNote={area?.note}
          carName={spec.name || 'your build'}
        />
      {:else}
        <div class="rounded-lg border border-dashed border-line bg-surface-1 p-6">
          <h3 class="type-heading text-base">Not enough to model yet</h3>
          <p class="mt-2 max-w-readable text-sm text-ink-secondary">
            The physics needs a few more figures before it can say anything. It
            will not fill them in for you — a defaulted number presented as a
            result is the one thing this site never does.
          </p>
          <p class="mt-3 text-sm">
            <span class="text-ink-secondary">Still needed:</span>
            <span class="font-medium">{missing.join(', ')}</span>
          </p>
        </div>
      {/if}
    </div>
  </section>
</div>
