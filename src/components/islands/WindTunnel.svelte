<script lang="ts">
  /**
   * The 3D wind tunnel.
   *
   * This component owns presentation and nothing else. It does not know where
   * the working section is, how large a cell is, how a body becomes a solid
   * mask, or which pass a flow mode needs — `windTunnel.ts` is the whole
   * surface, and the last time that knowledge was spread across the UI the
   * smoke drifted off the car.
   *
   * Every non-negotiable from the spec:
   *  - **Lazily loaded** — the solver sits behind a dynamic `import()` that
   *    only fires when the visitor starts it.
   *  - **Capability-gated** — no WebGL2 or no float render targets, and the tab
   *    says so plainly. The 2D readout is always the baseline.
   *  - **Device-scaled grid**, smaller on phones.
   *  - **User-initiated**, never on page load.
   *  - **Pauses when the tab is hidden.**
   *  - **`prefers-reduced-motion`** resolves a frame and stops.
   *
   * And the honesty rules: the car's published Cd stays authoritative, the body
   * is a fitted shape family rather than that exact car, and the resolution
   * limit is stated in millimetres rather than implied.
   */
  import type { WindTunnel } from '../../lib/windtunnel/windTunnel.ts';
  import type { ColorModeId, FlowModeId } from '../../lib/windtunnel/flow.ts';
  import type { Fan } from '../../lib/windtunnel/fans.ts';
  import type { RakeConfig } from '../../lib/windtunnel/sources.ts';
  import type { Snippet } from 'svelte';

  interface Props {
    carName: string;
    bodyStyles: string[];
    lengthM: number | null;
    widthM: number | null;
    heightM: number | null;
    publishedCd: number | null;
    /**
     * Who the subject is.
     *
     * `car` measures a shape family fitted to a real car's published
     * dimensions, and everything it says is framed against that car's own
     * published Cd, which stays authoritative. `build` measures a shape the
     * visitor is inventing, where there is no published figure
     * to defer to and the solver's number is the only one there is — which is
     * exactly why it must never be called validated.
     */
    variant?: 'car' | 'build';
    /**
     * Hands a completed measurement back to the caller — the closed
     * loop. Cd and frontal area travel together because they are one
     * measurement of one shape.
     */
    onMeasure?: (cd: number, frontalAreaM2: number) => void;
  }

  let {
    carName,
    bodyStyles,
    lengthM,
    widthM,
    heightM,
    publishedCd,
    variant = 'car',
    onMeasure,
  }: Props = $props();

  // --- lifecycle state -----------------------------------------------------
  let canvas = $state<HTMLCanvasElement | null>(null);
  let supported = $state<boolean | null>(null);
  let running = $state(false);
  let loading = $state(false);
  let started = $state(false);
  let rebuilding = $state(false);
  let diverged = $state(false);
  let error = $state<string | null>(null);
  let reduceMotion = $state(false);

  // --- readouts ------------------------------------------------------------
  let solverCd = $state<number | null>(null);
  let solverAreaM2 = $state<number | null>(null);
  let handedOff = $state(false);
  let steps = $state(0);
  let reynolds = $state(0);
  let cellSizeMm = $state(0);
  let gridLabel = $state('');
  let fps = $state(0);
  let disturbed = $state(false);
  let modelLabel = $state('');
  let modelNote = $state('');
  let modelSubstituted = $state(false);

  // --- controls, mirrored from the tunnel's own settings -------------------
  let flowMode = $state<FlowModeId>('ribbon');
  let colorBy = $state<ColorModeId>('speed');
  let rake = $state<RakeConfig>({ rows: 9, cols: 1 });
  let density = $state(1);
  let activeFans = $state<string[]>([]);
  let yawDeg = $state(0);
  let appliedYawDeg = $state(0);
  let showBox = $state(true);
  let quality = $state<'low' | 'medium' | 'high'>('high');
  let simPct = $state(60);
  let drawerOpen = $state(true);

  // --- vocabulary, loaded with the module ----------------------------------
  let flowModes = $state<{ id: FlowModeId; label: string; question: string; detail: string }[]>([]);
  let colorModes = $state<{ id: ColorModeId; label: string; detail: string }[]>([]);
  let rakePresets = $state<{ label: string; rake: RakeConfig }[]>([]);
  let fanPresets = $state<Fan[]>([]);
  let modeUsesSources = $state<(m: FlowModeId) => boolean>(() => true);

  // --- camera --------------------------------------------------------------
  const HOME = { yaw: -0.72, pitch: 0.17, dist: 9.8 };
  let cam = { ...HOME };
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  let tunnel: WindTunnel | null = null;
  let frame = 0;
  let destroyed = false;
  let lastFrameTime = 0;
  let frameAccum = 0;
  let frameCount = 0;

  const QUALITIES = ['low', 'medium', 'high'] as const;

  const canModel = $derived(lengthM !== null && widthM !== null && heightM !== null);

  /**
   * The shape the *running* solver was built from, against the shape the props
   * describe now.
   *
   * Dimensions are fixed for a car and editable for a build, and a body cannot
   * be restretched in place: the fit is compiled into the shaders. So when they
   * diverge the panel says the picture is of the old shape and offers to build
   * the new one — which is honest, where silently leaving a stale body on
   * screen beside a live-looking readout would not be.
   */
  const shape = $derived(`${bodyStyles.join(',')}|${lengthM}|${widthM}|${heightM}`);

  /**
   * Steps before a drag figure is steady enough to hand to another model.
   *
   * The force is a rolling mean of thirty samples taken every twenty-four
   * steps, so the averaging window is not even full until about seven hundred
   * steps, and the field itself is still starting up well past that. Watching
   * the number settle on screen is fine — it is labelled as a live reading —
   * but committing a transient into the performance model would put a figure
   * behind a top speed that nothing on screen still supports.
   */
  const SETTLED_STEPS = 1500;
  const settled = $derived(steps >= SETTLED_STEPS);
  let builtShape = $state('');
  const stale = $derived(started && builtShape !== '' && builtShape !== shape);
  const activeMode = $derived(flowModes.find((m) => m.id === flowMode) ?? null);

  function view() {
    const target = { x: 2.05, y: 0.68, z: 0 };
    const cp = Math.cos(cam.pitch);
    return {
      target,
      camera: {
        x: target.x + cam.dist * cp * Math.cos(cam.yaw),
        y: target.y + cam.dist * Math.sin(cam.pitch) + 0.5,
        z: target.z + cam.dist * cp * Math.sin(cam.yaw),
      },
    };
  }

  async function start() {
    if (running || loading || !canvas || !canModel) return;
    loading = true;
    error = null;

    try {
      const tunnelMod = await import('../../lib/windtunnel/windTunnel.ts');
      const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
      if (!gl) throw new Error('WebGL2 is not available in this browser.');

      tunnel = new tunnelMod.WindTunnel(gl, {
        bodyStyles,
        dimensions: { lengthM, widthM, heightM },
        quality,
      });

      const s = tunnel.solver.stats();
      const map = tunnel.solver.map;
      gridLabel = `${map.nx}×${map.ny}×${map.nz}`;
      cellSizeMm = Math.round(s.cellSizeM * 1000);
      modelLabel = tunnel.model.label;
      modelNote = tunnel.model.note;
      modelSubstituted = tunnel.choice.substituted;

      tunnel.update({ flow: flowMode, color: colorBy, rake, density, showBox, quality });
      // Spend the featureless first few hundred steps behind the loading state.
      tunnel.prime();

      builtShape = shape;
      solverAreaM2 = tunnel.stats().frontalAreaM2;
      handedOff = false;
      started = true;
      running = true;
      loading = false;
      lastFrameTime = performance.now();
      loop();
    } catch (e) {
      loading = false;
      error = e instanceof Error ? e.message : 'The solver could not start.';
    }
  }

  function loop() {
    if (!tunnel || !canvas || destroyed) return;

    const perFrame = reduceMotion ? 90 : Math.max(1, Math.round((simPct / 100) * 8));
    tunnel.step(perFrame);

    const s = tunnel.stats();
    if (s.steps % 24 < perFrame) {
      tunnel.sampleForce();
      const after = tunnel.stats();
      solverCd = after.cd;
      solverAreaM2 = after.frontalAreaM2;
      reynolds = after.reynolds;
      disturbed = after.disturbed;
      if (after.diverged) {
        diverged = true;
        pause();
        return;
      }
    }
    steps = s.steps;

    resizeCanvas();
    tunnel.render({ width: canvas.width, height: canvas.height, ...view() });

    const now = performance.now();
    frameAccum += now - lastFrameTime;
    lastFrameTime = now;
    if (++frameCount >= 20) {
      fps = Math.round(1000 / (frameAccum / frameCount));
      frameAccum = 0;
      frameCount = 0;
    }

    if (reduceMotion) {
      running = false;
      return;
    }
    frame = requestAnimationFrame(loop);
  }

  function resizeCanvas() {
    if (!canvas || !tunnel) return;
    const { width, height } = tunnel.bufferSize(
      canvas.clientWidth,
      canvas.clientHeight,
      window.devicePixelRatio || 1,
    );
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  /** Redraws a single frame when paused, so the controls stay live. */
  function redraw() {
    if (!tunnel || !canvas || running) return;
    resizeCanvas();
    tunnel.redraw({ width: canvas.width, height: canvas.height, ...view() });
  }

  /**
   * Applies a change and mirrors the result back.
   *
   * The tunnel may adjust more than was asked — switching to Mist also swaps
   * the rake for one dense enough to be a mist — so the controls read their new
   * positions from it rather than assuming the patch was applied verbatim.
   */
  function apply(patch: Parameters<WindTunnel['update']>[0]) {
    if (!tunnel) return;
    tunnel.update(patch);
    const now = tunnel.current;
    flowMode = now.flow;
    colorBy = now.color;
    rake = now.rake;
    density = now.density;
    showBox = now.showBox;
    quality = now.quality;
    redraw();
  }

  function resume() {
    if (!tunnel || running) return;
    running = true;
    lastFrameTime = performance.now();
    loop();
  }

  /**
   * Throws the current solve away and builds the new shape.
   *
   * A full teardown rather than a patch: the fit is baked into the compiled
   * GLSL, so there is nothing to update in place, and a fresh lattice is also
   * the only way to be sure no momentum from the old body survives into the
   * new body's drag figure.
   */
  async function rebuild() {
    pause();
    tunnel?.dispose();
    tunnel = null;
    started = false;
    diverged = false;
    solverCd = null;
    solverAreaM2 = null;
    builtShape = '';
    steps = 0;
    await start();
  }

  function pause() {
    running = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function clearFlow() {
    tunnel?.clearFlow();
    redraw();
  }

  function resetView() {
    cam = { ...HOME };
    tunnel?.renderer.invalidateScene();
    redraw();
  }

  function setCamera(yaw: number, pitch: number, dist: number) {
    cam = { yaw, pitch, dist };
    tunnel?.renderer.invalidateScene();
    redraw();
  }

  function toggleFan(id: string) {
    activeFans = activeFans.includes(id)
      ? activeFans.filter((f) => f !== id)
      : [...activeFans, id];
    apply({ fans: activeFans });
  }

  /**
   * Commits the yaw to the lattice.
   *
   * Rasterising the body is a few hundred thousand SDF evaluations, so it runs
   * when the slider is released rather than on every pixel of drag. Until it
   * runs, the rendered car keeps the yaw the fluid is actually seeing — showing
   * a turned car in an unturned flow field would be the more misleading of the
   * two options.
   */
  function commitYaw() {
    if (!tunnel || appliedYawDeg === yawDeg) return;
    rebuilding = true;
    requestAnimationFrame(() => {
      if (!tunnel) return;
      tunnel.update({ yawDeg });
      appliedYawDeg = yawDeg;
      solverCd = null;
      rebuilding = false;
      redraw();
    });
  }

  // --- pointer orbit -------------------------------------------------------
  function onPointerDown(e: PointerEvent) {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    cam.yaw += (e.clientX - lastX) * 0.006;
    cam.pitch = Math.max(-0.04, Math.min(1.0, cam.pitch + (e.clientY - lastY) * 0.004));
    lastX = e.clientX;
    lastY = e.clientY;
    tunnel?.renderer.invalidateScene();
    redraw();
  }
  function onPointerUp(e: PointerEvent) {
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    cam.dist = Math.max(4.5, Math.min(20, cam.dist + e.deltaY * 0.006));
    tunnel?.renderer.invalidateScene();
    redraw();
  }

  $effect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = q.matches;
    const onMotion = (e: MediaQueryListEvent) => (reduceMotion = e.matches);
    q.addEventListener('change', onMotion);

    const narrow = window.matchMedia('(max-width: 1023px)');
    drawerOpen = !narrow.matches;

    const onVisibility = () => {
      if (document.hidden && running) pause();
    };
    document.addEventListener('visibilitychange', onVisibility);

    /*
     * The capability probe and the control vocabulary load with the component;
     * the solver does not. These three modules are a few kilobytes of labels and
     * a feature test, and loading them here is what lets the drawer render its
     * real choices before anyone presses Start — a panel of empty boxes is not a
     * useful preview of what the tunnel can do.
     */
    Promise.all([
      import('../../lib/windtunnel/gl.ts'),
      import('../../lib/windtunnel/flow.ts'),
      import('../../lib/windtunnel/sources.ts'),
      import('../../lib/windtunnel/fans.ts'),
    ])
      .then(([glMod, flowMod, sourcesMod, fansMod]) => {
        supported = glMod.isSupported();
        flowModes = [...flowMod.FLOW_MODES];
        colorModes = [...flowMod.COLOR_MODES];
        modeUsesSources = flowMod.modeUsesSources;
        rakePresets = [...sourcesMod.RAKE_PRESETS];
        fanPresets = [...fansMod.FAN_PRESETS];
      })
      .catch(() => (supported = false));

    return () => {
      destroyed = true;
      q.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      if (frame) cancelAnimationFrame(frame);
      tunnel?.dispose();
      tunnel = null;
    };
  });
</script>

{#snippet section(title: string, open: boolean, body: Snippet)}
  <details class="group border-b border-line last:border-b-0" {open}>
    <summary
      class="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.1em] text-ink-secondary hover:text-ink"
    >
      {title}
      <span class="text-ink-muted transition-transform duration-150 group-open:rotate-90">›</span>
    </summary>
    <div class="px-4 pb-4 pt-1">{@render body()}</div>
  </details>
{/snippet}

{#if supported === false}
  <div class="rounded-lg border border-dashed border-line bg-surface-1 p-6">
    <h3 class="type-heading text-base">The wind tunnel can't run on this device</h3>
    <p class="mt-2 max-w-readable text-sm text-ink-secondary">
      It needs WebGL2 with floating-point render targets, which this browser
      doesn't provide. Nothing else on the page depends on it — the instrumented
      readout is the baseline and is unaffected.
    </p>
  </div>
{:else if !canModel}
  <div class="rounded-lg border border-dashed border-line bg-surface-1 p-6">
    <h3 class="type-heading text-base">No dimensions to build a body from</h3>
    <p class="mt-2 max-w-readable text-sm text-ink-secondary">
      The tunnel fits a representative body to a length, a width and a height.
      {variant === 'build'
        ? 'Give the build all three and it will run.'
        : `We haven't sourced all three for ${carName} yet.`}
    </p>
  </div>
{:else}
  <div class="flex flex-col gap-3">
    <div
      class="grid gap-0 overflow-hidden rounded-xl border border-line bg-[#05070a] lg:h-[min(74vh,40rem)] {drawerOpen
        ? 'lg:grid-cols-[17rem_minmax(0,1fr)]'
        : 'lg:grid-cols-1'}"
    >
      <!-- The drawer -->
      {#if drawerOpen}
        <!-- Bounded and scrolling: the panel is taller than the stage, and a
             control column that stretches the viewport past the picture it
             controls is the wrong way round. -->
        <aside
          class="min-w-0 border-line bg-surface-1 max-lg:border-b lg:h-full lg:overflow-y-auto lg:border-r"
        >
          <div class="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span class="type-data text-xs font-semibold uppercase tracking-[0.12em]">
              Working section
            </span>
            <button
              type="button"
              class="pressable rounded p-1 text-ink-muted hover:text-ink"
              onclick={() => (drawerOpen = false)}
              aria-label="Hide the controls"
            >
              ‹‹
            </button>
          </div>

          {#snippet flowBody()}
            <div class="grid grid-cols-2 gap-1.5">
              {#each flowModes as m (m.id)}
                <button
                  type="button"
                  class="pressable rounded-md border px-2 py-1.5 text-xs font-medium transition-colors duration-150 {flowMode ===
                  m.id
                    ? 'border-[var(--brand-accent)] bg-[var(--brand-accent)]/12 text-ink'
                    : 'border-transparent bg-surface-2 text-ink-secondary'}"
                  onclick={() => {
                    flowMode = m.id;
                    apply({ flow: m.id });
                  }}
                  disabled={!started}
                >
                  {m.label}
                </button>
              {/each}
            </div>
            {#if activeMode}
              <p class="mt-2.5 text-xs leading-relaxed text-ink-muted">
                <span class="text-ink-secondary">{activeMode.question}</span>
                {activeMode.detail}
              </p>
            {/if}

            <p class="mt-4 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">
              Colour by
            </p>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              {#each colorModes as c (c.id)}
                <button
                  type="button"
                  class="pressable rounded border px-2 py-1 text-[0.6875rem] transition-colors duration-150 {colorBy ===
                  c.id
                    ? 'border-[var(--brand-accent)] text-ink'
                    : 'border-line text-ink-secondary'}"
                  onclick={() => {
                    colorBy = c.id;
                    apply({ color: c.id });
                  }}
                  disabled={!started || flowMode === 'pressure'}
                  title={c.detail}
                >
                  {c.label}
                </button>
              {/each}
            </div>
            {#if flowMode === 'pressure'}
              <p class="mt-1.5 text-[0.6875rem] text-ink-muted">
                The pressure view has its own scale — red pushing in, blue pulling.
              </p>
            {/if}

            {#if modeUsesSources(flowMode)}
              <p class="mt-4 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">
                Sources <span class="normal-case tracking-normal">(masts × nozzles)</span>
              </p>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                {#each rakePresets as p (p.label)}
                  <button
                    type="button"
                    class="type-data pressable rounded border px-2 py-1 text-[0.6875rem] tabular-nums transition-colors duration-150 {rake.rows ===
                      p.rake.rows && rake.cols === p.rake.cols
                      ? 'border-[var(--brand-accent)] text-ink'
                      : 'border-line text-ink-secondary'}"
                    onclick={() => {
                      rake = p.rake;
                      apply({ rake: p.rake });
                    }}
                    disabled={!started}
                  >
                    {p.label}
                  </button>
                {/each}
              </div>

              <label class="mt-3 block">
                <span class="flex items-baseline justify-between text-[0.6875rem] text-ink-muted">
                  <span>Density</span>
                  <span class="type-data tabular-nums text-ink-secondary">
                    {Math.round(density * 100)}%
                  </span>
                </span>
                <input
                  type="range"
                  min="0.3"
                  max="1.8"
                  step="0.1"
                  bind:value={density}
                  oninput={() => apply({ density })}
                  disabled={!started}
                  class="mt-1 w-full accent-[var(--brand-accent)]"
                />
              </label>
            {/if}
          {/snippet}
          {@render section('Flow', true, flowBody)}

          {#snippet bodyBody()}
            <p class="text-xs leading-relaxed text-ink-muted">
              <span class="text-ink-secondary">{modelLabel}</span> — {modelNote}
            </p>
            {#if modelSubstituted}
              <p class="mt-1.5 text-[0.6875rem] leading-relaxed text-status-estimated">
                There is no model for this car's body style yet, so the nearest
                shape is standing in.
              </p>
            {/if}

            <label class="mt-3 block">
              <span class="flex items-baseline justify-between text-[0.6875rem] text-ink-muted">
                <span>Yaw to the wind</span>
                <span class="type-data tabular-nums text-ink-secondary">{yawDeg}°</span>
              </span>
              <input
                type="range"
                min="-30"
                max="30"
                step="2"
                bind:value={yawDeg}
                onchange={commitYaw}
                disabled={!started}
                class="mt-1 w-full accent-[var(--brand-accent)]"
              />
            </label>
            <p class="mt-1 text-[0.6875rem] text-ink-muted">
              Turning the car re-rasterises the body the fluid sees, so the wake
              restarts.
            </p>
          {/snippet}
          {@render section('Body', true, bodyBody)}

          {#snippet fansBody()}
            <p class="mb-2 text-[0.6875rem] leading-relaxed text-ink-muted">
              Extra flows, added to the solve as a real body force. A drag figure
              measured with one running describes the car in that disturbed air.
            </p>
            <div class="flex flex-col gap-1.5">
              {#each fanPresets as f (f.id)}
                <label class="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    class="size-3.5"
                    checked={activeFans.includes(f.id)}
                    onchange={() => toggleFan(f.id)}
                    disabled={!started}
                  />
                  <span>{f.label}</span>
                </label>
              {/each}
            </div>
          {/snippet}
          {@render section('Auxiliary fans', false, fansBody)}

          {#snippet cameraBody()}
            <div class="flex flex-wrap gap-1.5">
              <button
                type="button"
                class="pressable rounded border border-line px-2 py-1 text-[0.6875rem]"
                onclick={() => setCamera(-1.5708, 0.05, 9.0)}>Side</button
              >
              <button
                type="button"
                class="pressable rounded border border-line px-2 py-1 text-[0.6875rem]"
                onclick={() => setCamera(-3.14159, 0.12, 9.5)}>Front</button
              >
              <button
                type="button"
                class="pressable rounded border border-line px-2 py-1 text-[0.6875rem]"
                onclick={() => setCamera(0.0, 0.14, 9.5)}>Rear</button
              >
              <button
                type="button"
                class="pressable rounded border border-line px-2 py-1 text-[0.6875rem]"
                onclick={() => setCamera(-1.5708, 1.02, 11.0)}>Plan</button
              >
              <button
                type="button"
                class="pressable rounded border border-line px-2 py-1 text-[0.6875rem]"
                onclick={resetView}>Reset</button
              >
            </div>

            <p class="mt-3 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">
              Quality
            </p>
            <div class="mt-1.5 flex gap-1.5">
              {#each QUALITIES as qid (qid)}
                <button
                  type="button"
                  class="pressable rounded border px-2 py-1 text-[0.6875rem] capitalize {quality ===
                  qid
                    ? 'border-[var(--brand-accent)] text-ink'
                    : 'border-line text-ink-secondary'}"
                  onclick={() => {
                    quality = qid;
                    apply({ quality: qid });
                  }}
                  disabled={!started}
                >
                  {qid}
                </button>
              {/each}
            </div>

            <label class="mt-3 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                class="size-3.5"
                bind:checked={showBox}
                onchange={() => apply({ showBox })}
                disabled={!started}
              />
              <span>Show the working section</span>
            </label>
          {/snippet}
          {@render section('Camera & quality', false, cameraBody)}

          {#snippet physicsBody()}
            <label class="block">
              <span class="flex items-baseline justify-between text-[0.6875rem] text-ink-muted">
                <span>Simulation speed</span>
                <span class="type-data tabular-nums text-ink-secondary">{simPct}%</span>
              </span>
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                bind:value={simPct}
                disabled={!started}
                class="mt-1 w-full accent-[var(--brand-accent)]"
              />
            </label>
            <p class="mt-1.5 text-[0.6875rem] leading-relaxed text-ink-muted">
              Lattice steps per frame. It changes how fast the solution advances,
              not how hard the wind blows.
            </p>
            <button
              type="button"
              class="pressable mt-3 w-full rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              onclick={clearFlow}
              disabled={!started}
            >
              Clear the smoke
            </button>
          {/snippet}
          {@render section('Physics', false, physicsBody)}
        </aside>
      {/if}

      <!-- The viewport -->
      <div class="relative min-w-0 lg:h-full">
        <canvas
          bind:this={canvas}
          class="block aspect-[16/10] w-full cursor-grab touch-none active:cursor-grabbing lg:aspect-auto lg:h-full"
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
          onwheel={onWheel}
          aria-label={`Airflow around a ${modelLabel || 'representative'} body`}
        ></canvas>

        {#if !drawerOpen}
          <button
            type="button"
            class="pressable absolute left-3 top-3 rounded-md border border-white/20 bg-black/50 px-2.5 py-1.5 text-xs text-white/85 backdrop-blur"
            onclick={() => (drawerOpen = true)}
          >
            Controls
          </button>
        {/if}

        {#if started}
          <div
            class="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-0.5 text-[0.6875rem] leading-tight text-white/45"
          >
            <span class="type-data tabular-nums">
              {steps.toLocaleString('en-GB')} steps · {gridLabel} · {cellSizeMm} mm cells · Re ≈ {reynolds.toFixed(
                0,
              )}{fps ? ` · ${fps} fps` : ''}
            </span>
            <span>Drag to orbit · scroll to zoom</span>
          </div>
        {/if}

        {#if rebuilding}
          <div
            class="pointer-events-none absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[0.6875rem] text-white/80"
          >
            Re-rasterising the body…
          </div>
        {/if}

        {#if !running && !loading}
          <div class="absolute inset-0 grid place-items-center bg-black/55 p-6 text-center">
            <div>
              <p class="mx-auto max-w-sm text-sm text-white/85">
                {started
                  ? 'Paused.'
                  : 'A lattice-Boltzmann solver, running on your GPU. It starts only when you ask it to.'}
              </p>
              <button
                type="button"
                class="pressable mt-3 rounded-lg border border-white/25 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur transition-colors duration-150 hover:bg-white/20"
                onclick={started ? resume : start}
              >
                {started ? 'Resume' : 'Start the wind tunnel'}
              </button>
            </div>
          </div>
        {/if}

        {#if loading}
          <div class="absolute inset-0 grid place-items-center bg-black/55">
            <p class="text-sm text-white/85">Building the lattice…</p>
          </div>
        {/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="pressable rounded-md border border-line bg-surface-1 px-3 py-1.5 text-sm font-medium"
        onclick={running ? pause : started ? resume : start}
      >
        {running ? 'Pause' : started ? 'Resume' : 'Start'}
      </button>
      {#if disturbed}
        <span class="rounded-md border border-status-estimated/40 bg-status-estimated/10 px-2.5 py-1.5 text-xs">
          A fan is running — the drag below is for this disturbed flow.
        </span>
      {/if}
      {#if stale}
        <span
          class="flex flex-wrap items-center gap-2 rounded-md border border-status-estimated/40 bg-status-estimated/10 px-2.5 py-1.5 text-xs"
        >
          The dimensions changed. This is still the old shape.
          <button
            type="button"
            class="pressable rounded border border-line-strong bg-surface-2 px-2 py-1 font-medium"
            onclick={rebuild}
          >
            Build the new one
          </button>
        </span>
      {/if}
    </div>

    {#if error}
      <p class="rounded-lg border border-status-conflicting/40 bg-status-conflicting/10 p-3 text-sm">
        {error}
      </p>
    {/if}

    {#if diverged}
      <p
        class="max-w-readable rounded-lg border border-status-conflicting/40 bg-status-conflicting/10 p-3 text-sm leading-relaxed"
      >
        <strong>The solve went unstable and has been stopped.</strong> A
        lattice-Boltzmann run can go non-finite, and when it does everything
        downstream of it is meaningless — so the drag figure is withdrawn rather
        than left on screen. Reload the page to start a fresh run.
      </p>
    {/if}

    <!-- Solver Cd beside the published one, never instead of it -->
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="min-w-0 rounded-lg border border-line bg-surface-1 p-4">
        <p class="text-xs uppercase tracking-wide text-ink-muted">
          {variant === 'build' ? 'The build’s Cd' : 'Published Cd'}
        </p>
        <p class="type-data mt-1 text-2xl font-semibold tabular-nums">
          {publishedCd !== null ? publishedCd.toFixed(2) : '—'}
        </p>
        <p class="mt-2 text-xs leading-relaxed text-ink-muted">
          {variant === 'build'
            ? 'What the performance model is using right now. Yours to set, and yours to replace with the measurement on the right.'
            : "The manufacturer's figure for the real car. This stays authoritative."}
        </p>
      </div>
      <div class="min-w-0 rounded-lg border border-line bg-surface-1 p-4">
        <p class="text-xs uppercase tracking-wide text-ink-muted">This solver, on a fitted shape</p>
        <p class="type-data mt-1 flex flex-wrap items-baseline gap-x-3 text-2xl font-semibold tabular-nums">
          <span>{solverCd !== null ? solverCd.toFixed(2) : '—'}</span>
          {#if solverAreaM2 !== null && solverAreaM2 > 0}
            <span class="text-sm font-normal text-ink-muted">
              over {solverAreaM2.toFixed(2)} m²
            </span>
          {/if}
        </p>
        <p class="mt-2 text-xs leading-relaxed text-ink-muted">
          {#if variant === 'build'}
            Measured on a {modelLabel || 'representative shape'} fitted to the
            dimensions you set. Nobody has published a Cd for a shape you just
            invented, so there is nothing to validate it against and none is
            claimed — it is what this solver, at this resolution, measured.
          {:else}
            Measured on a {modelLabel || 'representative shape'}, not on {carName}.
            Not comparable with the figure on the left.
          {/if}
        </p>

        <!--
          The closed loop, and the one control on this panel that
          changes something outside it. Withheld while the run is unusable: a
          diverged solve reports nothing, and a figure taken in a running fan's
          wake describes the shape in that wake rather than in clean air.
        -->
        {#if onMeasure}
          <button
            type="button"
            class="pressable mt-3 w-full rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-sm font-medium transition-colors duration-150 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={solverCd === null ||
              solverAreaM2 === null ||
              diverged ||
              disturbed ||
              stale ||
              !settled}
            onclick={() => {
              if (solverCd === null || solverAreaM2 === null) return;
              onMeasure(solverCd, solverAreaM2);
              handedOff = true;
              setTimeout(() => (handedOff = false), 2500);
            }}
          >
            Use this Cd and area in the build
          </button>
          {#if handedOff}
            <p class="mt-2 text-xs leading-relaxed text-status-verified">
              Applied. Every figure below the tunnel is now computed from the
              shape rather than from a typed coefficient.
            </p>
          {/if}
          {#if disturbed}
            <p class="mt-2 text-xs leading-relaxed text-ink-muted">
              Turn the fans off first — drag measured in disturbed air describes
              the shape in that air, not on a road.
            </p>
          {:else if started && !settled && !diverged}
            <p class="mt-2 text-xs leading-relaxed text-ink-muted">
              Still settling — {steps.toLocaleString('en-GB')} of about {SETTLED_STEPS.toLocaleString(
                'en-GB',
              )} steps. The reading above is live and still moving; it can be
              handed to the build once the wake has developed.
            </p>
          {/if}
        {/if}
      </div>
    </div>

    <div class="rounded-lg border border-line bg-surface-2 p-4">
      <p class="max-w-readable text-xs leading-relaxed text-ink-secondary">
        <strong class="text-ink">What you are looking at, stated plainly.</strong>
        A real lattice-Boltzmann solver running on your GPU — the smoke is carried
        by the velocity field it computes, not a decorative particle effect, and
        turning the car re-rasterises the body the fluid sees. But the body is a
        <strong class="text-ink">{modelLabel || 'representative shape'}</strong>
        stretched onto {variant === 'build'
          ? 'the dimensions you set'
          : `${carName}'s published dimensions`}, not a scan of a car. At
        {cellSizeMm || '—'} mm per cell it resolves large-scale separation and the shape
        of the wake; it does not resolve the near-wall boundary layer, the gap between
        tyre and arch, or absolute drag to engineering tolerance. Treat the number
        above as a property of the shape at this scale, not of a car.
      </p>
    </div>
  </div>
{/if}
