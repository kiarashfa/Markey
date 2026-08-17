<script lang="ts">
  /**
   * Homepage spotlight — SPEC.md §11.1, built against `.claude/skills/apple-design`.
   *
   * The one place on the site with a real motion budget. Everything below the
   * fold is calm reference content; this is the "wow" moment before it.
   *
   * Why hand-rolled rather than a carousel library: SPEC.md §3 asks for a
   * spring-capable approach for gesture-driven motion, and the specific
   * behaviours below are the whole point of the component — a library that
   * animates on a fixed timeline would fail every one of them.
   *
   *  - **1:1 tracking** (apple-design §2). The track follows the pointer
   *    exactly, from the offset where it was grabbed. Pointer capture keeps
   *    tracking alive when the pointer leaves the element.
   *  - **Interruptibility** (§3, the important one). The spring integrates from
   *    the *current on-screen* position and velocity, so a slide can be grabbed
   *    mid-flight and thrown back the other way with no jump and no dead time.
   *  - **Velocity handoff** (§5). Release velocity becomes the spring's initial
   *    velocity, so there is no seam between dragging and animating.
   *  - **Momentum projection** (§6). The landing slide is chosen from where the
   *    flick is *going*, using Apple's exponential-decay projection — not from
   *    where the finger happened to lift.
   *  - **Rubber-banding** (§9). Past the first or last slide, resistance rises
   *    rather than hitting an invisible wall.
   *  - **Reduced motion** (§14) is a first-class path, not an afterthought: a
   *    cross-fade with no transform motion and no drag, which is a gentler
   *    equivalent rather than the absence of feedback.
   *
   * Deliberately does **not** auto-advance. SPEC.md §11.1 calls the set
   * "rotating", but an unattended auto-rotating hero steals control from the
   * reader (apple-design §16, agency) and is a known accessibility problem. The
   * curated set rotates when the curation changes.
   */

  import {
    clampWithRubberband,
    snapTarget,
    velocityFrom,
  } from '../../lib/motion/gesture.ts';

  interface SpotlightStat {
    label: string;
    value: string;
  }

  interface SpotlightCar {
    id: string;
    name: string;
    kicker: string;
    url: string;
    brandName: string;
    accentColor: string;
    logoSrc: string;
    logoAlt: string;
    heroSrc?: string;
    heroAlt?: string;
    stats: SpotlightStat[];
  }

  let { cars }: { cars: SpotlightCar[] } = $props();

  let index = $state(0);
  let viewport = $state<HTMLDivElement | null>(null);
  let track = $state<HTMLDivElement | null>(null);
  let width = $state(0);
  let dragging = $state(false);
  let reduceMotion = $state(false);

  const multiple = $derived(cars.length > 1);

  // --- spring -------------------------------------------------------------
  // Apple parameterises springs as (response, damping ratio) rather than
  // (mass, stiffness, damping) — see apple-design §4. `response 0.42` with
  // damping just under 1 gives a settle that feels immediate without the
  // overshoot that would look silly on a full-bleed photograph.
  const RESPONSE = 0.42;
  const DAMPING = 0.92;

  let offset = 0; // px, current on-screen translation of the track
  let velocity = 0; // px/s
  let target = 0; // px
  let frame = 0;
  let lastTime = 0;

  function applyTransform() {
    if (track) track.style.transform = `translate3d(${offset}px, 0, 0)`;
  }

  function tick(now: number) {
    const dt = Math.min((now - lastTime) / 1000, 1 / 30); // clamp after a tab stall
    lastTime = now;

    const omega = (2 * Math.PI) / RESPONSE;
    const displacement = offset - target;
    // Standard damped-harmonic integration. Semi-implicit Euler is stable
    // enough at these stiffnesses and keeps the whole thing dependency-free.
    const accel = -omega * omega * displacement - 2 * DAMPING * omega * velocity;
    velocity += accel * dt;
    offset += velocity * dt;

    applyTransform();

    if (Math.abs(offset - target) < 0.4 && Math.abs(velocity) < 8) {
      offset = target;
      velocity = 0;
      applyTransform();
      frame = 0;
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  function springTo(next: number, initialVelocity = velocity) {
    target = next;
    velocity = initialVelocity;
    if (reduceMotion) {
      offset = target;
      velocity = 0;
      applyTransform();
      return;
    }
    if (frame) cancelAnimationFrame(frame);
    lastTime = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function goTo(next: number, initialVelocity = 0) {
    index = Math.max(0, Math.min(cars.length - 1, next));
    springTo(-index * width, initialVelocity);
  }

  // --- gesture ------------------------------------------------------------
  let startX = 0;
  let startOffset = 0;
  let samples: { x: number; t: number }[] = [];
  let committed = false;

  function onPointerDown(event: PointerEvent) {
    if (!multiple || reduceMotion || event.button !== 0) return;
    // Multi-touch protection: a second finger mid-drag would jump the track.
    if (dragging) return;

    dragging = true;
    committed = false;
    startX = event.clientX;
    startOffset = offset;
    samples = [{ x: event.clientX, t: performance.now() }];

    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    velocity = 0;

    // Capture keeps tracking alive when the pointer leaves the element
    // (apple-design §2). It throws if the pointer is already gone, which must
    // not abort the drag — the drag still works without capture.
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* no capture available; 1:1 tracking still works inside the element */
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const delta = event.clientX - startX;

    // ~10px of hysteresis before committing to a horizontal drag, so a vertical
    // page scroll that starts on the carousel isn't stolen (apple-design §10).
    if (!committed) {
      if (Math.abs(delta) < 10) return;
      committed = true;
    }

    offset = clampWithRubberband(
      startOffset + delta,
      -(cars.length - 1) * width,
      0,
      width,
    );
    applyTransform();

    samples.push({ x: event.clientX, t: performance.now() });
    if (samples.length > 6) samples.shift();
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      /* capture was never taken */
    }
    if (!committed) return;

    const releaseVelocity = velocityFrom(samples);
    goTo(snapTarget(offset, releaseVelocity, width, cars.length), releaseVelocity);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!multiple) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goTo(index - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goTo(index + 1);
    }
  }

  // --- lifecycle ----------------------------------------------------------
  $effect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = query.matches;
    const onChange = (e: MediaQueryListEvent) => (reduceMotion = e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  });

  $effect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? 0;
      if (next === 0 || next === width) return;
      width = next;
      // Re-anchor without animating: a resize is not an interaction.
      offset = -index * width;
      target = offset;
      velocity = 0;
      applyTransform();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  });

  $effect(() => {
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  });
</script>

{#if cars.length > 0}
  <section
    class="relative isolate overflow-hidden border-b border-line"
    style={`--brand-accent: ${cars[index]?.accentColor ?? 'currentColor'};`}
    aria-roledescription="carousel"
    aria-label="Featured cars"
  >
    <!--
      One wash layer per car, cross-faded by opacity.

      The obvious implementation — a single layer whose gradient changes with
      the active car — silently does nothing: CSS cannot interpolate between two
      `linear-gradient` values, so the colour would hard-cut on every slide
      change. Stacked layers also keep this on the compositor-friendly side of
      the §11.4 rule (transform and opacity only), and the cross-fade is kept
      under reduced motion because a colour change aids comprehension without
      being vestibular motion.
    -->
    {#each cars as car, i (car.id)}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 -z-10 transition-opacity duration-500 ease-out"
        style={`opacity: ${i === index ? 1 : 0}; background: linear-gradient(165deg, color-mix(in oklab, ${car.accentColor} 30%, var(--color-surface-0)) 0%, var(--color-surface-0) 78%);`}
      ></div>
    {/each}

    <div
      bind:this={viewport}
      class="overflow-hidden"
      class:cursor-grab={multiple && !reduceMotion && !dragging}
      class:cursor-grabbing={dragging}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onkeydown={onKeyDown}
      role={multiple ? 'group' : undefined}
      tabindex={multiple ? 0 : undefined}
      aria-label={multiple ? 'Featured cars — use the left and right arrow keys' : undefined}
      style="touch-action: pan-y;"
    >
      <div bind:this={track} class="flex" style="will-change: transform;">
        {#each cars as car, i (car.id)}
          <article
            class="w-full shrink-0 transition-opacity duration-300 ease-out"
            style={`opacity: ${reduceMotion && i !== index ? 0 : 1};`}
            aria-hidden={i !== index ? 'true' : undefined}
            inert={i !== index ? true : undefined}
          >
            <div class="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
              <div class="grid gap-8 lg:grid-cols-[1fr_minmax(0,24rem)] lg:items-center">
                <div class="min-w-0">
                  <div class="flex items-center gap-3">
                    <span
                      class="inline-flex size-12 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white p-1.5 shadow-sm"
                      title={`${car.brandName} logo`}
                    >
                      <img
                        src={car.logoSrc}
                        alt={car.logoAlt}
                        class="size-full object-contain"
                        draggable="false"
                      />
                    </span>
                    <p
                      class="text-xs font-medium uppercase tracking-[0.14em] text-ink-secondary"
                    >
                      {car.kicker}
                    </p>
                  </div>

                  <h2 class="type-display mt-5 text-[clamp(2rem,7vw,3.5rem)]">
                    <a class="hover:underline" href={car.url} tabindex={i === index ? 0 : -1}>
                      {car.name}
                    </a>
                  </h2>

                  {#if car.stats.length > 0}
                    <dl class="mt-7 flex flex-wrap gap-x-8 gap-y-4">
                      {#each car.stats as stat (stat.label)}
                        <div class="min-w-0">
                          <dt class="text-xs uppercase tracking-wide text-ink-muted">
                            {stat.label}
                          </dt>
                          <dd class="type-data mt-1 text-lg font-semibold tabular-nums">
                            {stat.value}
                          </dd>
                        </div>
                      {/each}
                    </dl>
                  {/if}

                  <a
                    href={car.url}
                    tabindex={i === index ? 0 : -1}
                    class="pressable mt-8 inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface-0/80 px-4 py-2.5 text-sm font-medium backdrop-blur transition-colors duration-150 hover:bg-surface-0"
                  >
                    Read the entry
                    <span aria-hidden="true">&rarr;</span>
                  </a>
                </div>

                {#if car.heroSrc}
                  <figure class="min-w-0">
                    <img
                      src={car.heroSrc}
                      alt={car.heroAlt ?? ''}
                      draggable="false"
                      fetchpriority={i === 0 ? 'high' : 'low'}
                      loading={i === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                      class="w-full select-none rounded-xl border border-line/60 bg-surface-1 object-cover shadow-xl"
                    />
                  </figure>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </div>
    </div>

    {#if multiple}
      <div class="mx-auto flex w-full max-w-5xl items-center gap-3 px-5 pb-6 sm:px-8">
        <button
          type="button"
          class="pressable inline-flex size-9 items-center justify-center rounded-full border border-line bg-surface-0/80 backdrop-blur transition-colors duration-150 hover:bg-surface-1 disabled:opacity-40"
          onclick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Previous car"
        >
          <span aria-hidden="true">&larr;</span>
        </button>
        <button
          type="button"
          class="pressable inline-flex size-9 items-center justify-center rounded-full border border-line bg-surface-0/80 backdrop-blur transition-colors duration-150 hover:bg-surface-1 disabled:opacity-40"
          onclick={() => goTo(index + 1)}
          disabled={index === cars.length - 1}
          aria-label="Next car"
        >
          <span aria-hidden="true">&rarr;</span>
        </button>

        <ol class="flex flex-1 items-center justify-end gap-1.5">
          {#each cars as car, i (car.id)}
            <li>
              <!--
                The pill grows via `scaleX`, not `width`. Animating width would
                relayout the row on every slide change — the exact thing
                SPEC.md §11.4 rules out. The button keeps a constant 24x24 hit
                area regardless of what the bar inside it is doing, so the touch
                target never moves either.
              -->
              <button
                type="button"
                class="flex size-6 items-center justify-center"
                onclick={() => goTo(i)}
                aria-label={`Show ${car.name}`}
                aria-current={i === index ? 'true' : undefined}
              >
                <span
                  class="block h-1.5 w-6 rounded-full transition-[transform,background-color] duration-200 ease-out"
                  style={`transform: scaleX(${i === index ? 1 : 0.25}); background-color: ${
                    i === index ? 'var(--brand-accent)' : 'var(--color-line-strong)'
                  };`}
                ></span>
              </button>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  </section>
{/if}
