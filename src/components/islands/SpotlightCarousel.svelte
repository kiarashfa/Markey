<script lang="ts">
  /**
   * Homepage spotlight, built to Apple's interaction principles.
   *
   * The one place on the site with a real motion budget. Everything below the
   * fold is calm reference content; this is the "wow" moment before it.
   *
   * Why hand-rolled rather than a carousel library: the design asks for a
   * spring-capable approach for gesture-driven motion, and the specific
   * behaviours below are the whole point of the component — a library that
   * animates on a fixed timeline would fail every one of them.
   *
   *  - **1:1 tracking**. The track follows the pointer
   *    exactly, from the offset where it was grabbed. Pointer capture keeps
   *    tracking alive when the pointer leaves the element.
   *  - **Interruptibility** (the important one). The spring integrates from
   *    the *current on-screen* position and velocity, so a slide can be grabbed
   *    mid-flight and thrown back the other way with no jump and no dead time.
   *  - **Velocity handoff**. Release velocity becomes the spring's initial
   *    velocity, so there is no seam between dragging and animating.
   *  - **Momentum projection**. The landing slide is chosen from where the
   *    flick is *going*, using Apple's exponential-decay projection — not from
   *    where the finger happened to lift.
   *  - **Rubber-banding**. Past the first or last slide, resistance rises
   *    rather than hitting an invisible wall.
   *  - **Reduced motion** is a first-class path, not an afterthought: a
   *    cross-fade with no transform motion and no drag, which is a gentler
   *    equivalent rather than the absence of feedback.
   *
   * Deliberately does **not** auto-advance: an unattended auto-rotating hero
   * steals control from the reader and is a known accessibility problem.
   *
   * **A fixed, small set.** The homepage passes five cars, picked weekly from
   * the ones flagged for the spotlight, never the whole flagged list: a
   * carousel whose length grows with the catalogue is a carousel nobody reaches
   * the end of. Five also lets every slide be named in the controls, so the
   * row under the hero is a set of labelled tabs rather than a string of dots
   * that says only "there are more".
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
    heroSrcset?: string;
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
  // (mass, stiffness, damping). `response 0.42` with
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
    // No pointer capture yet: capturing on press retargets the click to the
    // carousel, so a link or button inside a slide never receives it. Capture
    // waits until the gesture is committed to a horizontal drag.
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const delta = event.clientX - startX;

    // ~10px of hysteresis before committing to a horizontal drag, so a vertical
    // page scroll that starts on the carousel isn't stolen.
    if (!committed) {
      if (Math.abs(delta) < 10) return;
      committed = true;
      // Capture keeps tracking alive when the pointer leaves the element. It
      // throws if the pointer is already gone, which must not abort the drag.
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        /* no capture available; 1:1 tracking still works inside the element */
      }
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

  /** A drag that ends over a link must not also follow it. */
  function onClickCapture(event: MouseEvent) {
    if (committed) {
      event.preventDefault();
      event.stopPropagation();
      committed = false;
    }
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

      Straight down, not at an angle: on a band far wider than it is tall an
      angled gradient reaches its last stop only in one bottom corner, and the
      other corner stayed tinted where the band meets the page.

      The obvious implementation — a single layer whose gradient changes with
      the active car — silently does nothing: CSS cannot interpolate between two
      `linear-gradient` values, so the colour would hard-cut on every slide
      change. Stacked layers also keep this on the compositor-friendly side of
      the motion rule (transform and opacity only), and the cross-fade is kept
      under reduced motion because a colour change aids comprehension without
      being vestibular motion.
    -->
    {#each cars as car, i (car.id)}
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 -z-10 transition-opacity duration-500 ease-out"
        style={`opacity: ${i === index ? 1 : 0}; background: linear-gradient(to bottom, color-mix(in oklab, ${car.accentColor} 30%, var(--color-surface-0)) 0%, var(--color-surface-0) 82%);`}
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
      onclickcapture={onClickCapture}
      onkeydown={onKeyDown}
      role={multiple ? 'group' : undefined}
      tabindex={multiple ? 0 : undefined}
      aria-label={multiple ? 'Featured cars. Use the left and right arrow keys' : undefined}
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
            <div class="mx-auto w-full max-w-(--layout-max) px-(--layout-gutter) py-10 sm:py-14">
              <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-center">
                <div class="min-w-0">
                  <div class="flex items-center gap-3">
                    <span
                      class="inline-flex size-12 shrink-0 items-center justify-center rounded-lg border bg-white p-1.5 shadow-sm"
                      style="border-color: color-mix(in oklab, var(--color-ink) 18%, transparent);"
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
                      srcset={car.heroSrcset}
                      sizes="(min-width: 64rem) 24rem, 90vw"
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
      <div class="mx-auto flex w-full max-w-(--layout-max) items-center gap-2 px-(--layout-gutter) pb-6">
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

        <span class="type-data w-12 shrink-0 text-center text-xs tabular-nums text-ink-secondary" aria-hidden="true">
          {index + 1} / {cars.length}
        </span>

        <!--
          Every slide, named. The rule under the active one grows by `scaleX`,
          not `width`, so a slide change never relayouts the row. On a phone
          the row scrolls sideways rather than wrapping. It is pushed right by an
          auto margin on the first item, not by `justify-end`: a flex row that
          overflows at its start cannot be scrolled back to it, which clipped
          the first names off a phone screen.
        -->
        <ol class="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto [scrollbar-width:none]">
          {#each cars as car, i (car.id)}
            <li class={`shrink-0 ${i === 0 ? 'ml-auto' : ''}`}>
              <button
                type="button"
                class="group flex max-w-[11rem] flex-col items-start gap-1 rounded-md px-2.5 pb-1.5 pt-1 text-left transition-colors duration-150 hover:bg-surface-0/60"
                onclick={() => goTo(i)}
                aria-label={`Show ${car.name}`}
                aria-current={i === index ? 'true' : undefined}
              >
                <span class="block w-full truncate text-[0.625rem] font-medium uppercase tracking-[0.12em] text-ink-muted">{car.kicker}</span>
                <span class={`block w-full truncate text-sm ${i === index ? 'text-ink' : 'text-ink-secondary group-hover:text-ink'}`}>{car.name}</span>
                <span
                  aria-hidden="true"
                  class="block h-0.5 w-full origin-left rounded-full transition-[transform,background-color] duration-200 ease-out"
                  style={`transform: scaleX(${i === index ? 1 : 0}); background-color: var(--brand-accent);`}
                ></span>
              </button>
            </li>
          {/each}
        </ol>
      </div>
    {/if}
  </section>
{/if}
