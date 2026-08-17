<script lang="ts">
  /**
   * Per-car photo gallery with a full-screen lightbox.
   *
   * ## Why it is built this way
   *
   * **Native `<dialog showModal()>` rather than a hand-rolled overlay.** The
   * W3C APG modal-dialog pattern requires: focus moved into the dialog on open,
   * Tab and Shift+Tab cycling *within* it, Escape closing it, focus returned to
   * the invoking element on close, and background content made genuinely inert
   * rather than merely covered. A native modal dialog gives every one of those
   * from the browser, correctly, including the top-layer stacking that stops a
   * lightbox being clipped by an ancestor's `overflow: hidden`. Hand-written
   * focus traps are a well-known source of accessibility bugs; using the
   * platform removes the whole class.
   *
   * **Progressive enhancement.** Each thumbnail is a real `<a href>` to the
   * full image, so with no JavaScript the gallery is still a working set of
   * links. The lightbox intercepts the click; it does not replace the link.
   *
   * **Neighbour preloading.** Established lightbox practice is that lazy
   * thumbnails plus *eagerly preloaded neighbours* is what makes a gallery feel
   * instant — without it every arrow press is a visible wait. Only the
   * neighbours: preloading twenty photographs up front would defeat the point.
   *
   * **Gesture handling reuses `lib/motion/gesture.ts`** — the same unit-tested
   * projection and rubber-band maths as the homepage carousel, so a swipe here
   * feels identical to a swipe there.
   *
   * ## Attribution
   * Credit travels with the image into the lightbox rather than living in a
   * list elsewhere — the same principle as the single-image popover, applied
   * where there is finally room to show it in full.
   */
  import { clampWithRubberband, snapTarget, velocityFrom } from '../../lib/motion/gesture.ts';

  interface GalleryImage {
    src: string;
    alt: string;
    caption?: string;
    width?: number;
    height?: number;
    author?: string;
    licenseLabel: string;
    licenseUrl?: string;
    sourceUrl: string;
    licenseNote?: string;
    attributionRequired: boolean;
  }

  let { images }: { images: GalleryImage[] } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let stage = $state<HTMLDivElement | null>(null);
  let track = $state<HTMLDivElement | null>(null);
  let index = $state(0);
  let open = $state(false);
  let reduceMotion = $state(false);
  let isFullscreen = $state(false);
  let width = $state(0);
  let dragging = $state(false);

  const count = $derived(images.length);
  const current = $derived(images[index]);
  const multiple = $derived(count > 1);

  // --- spring (same parameters as the spotlight carousel, for one feel) ----
  const RESPONSE = 0.4;
  const DAMPING = 0.95;

  let offset = 0;
  let velocity = 0;
  let target = 0;
  let frame = 0;
  let lastTime = 0;

  function applyTransform() {
    if (track) track.style.transform = `translate3d(${offset}px, 0, 0)`;
  }

  function tick(now: number) {
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;
    const omega = (2 * Math.PI) / RESPONSE;
    const displacement = offset - target;
    velocity += (-omega * omega * displacement - 2 * DAMPING * omega * velocity) * dt;
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

  function springTo(nextOffset: number, initialVelocity = velocity) {
    target = nextOffset;
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

  function goTo(nextIndex: number, initialVelocity = 0) {
    index = Math.max(0, Math.min(count - 1, nextIndex));
    springTo(-index * width, initialVelocity);
    preloadNeighbours();
  }

  const goPrev = () => goTo(index - 1);
  const goNext = () => goTo(index + 1);

  function preloadNeighbours() {
    for (const i of [index - 1, index + 1]) {
      const image = images[i];
      if (!image) continue;
      const preload = new Image();
      preload.src = image.src;
    }
  }

  // --- opening and closing -------------------------------------------------
  function openAt(i: number, event: MouseEvent) {
    // Let modified clicks (new tab, save image) do what the visitor asked.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    index = i;
    open = true;
    dialog?.showModal();
    // showModal() does not stop the page behind it from scrolling.
    document.documentElement.style.overflow = 'hidden';
    queueMicrotask(() => {
      measure();
      offset = -index * width;
      target = offset;
      applyTransform();
      preloadNeighbours();
    });
  }

  function close() {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    dialog?.close();
  }

  function onDialogClose() {
    open = false;
    document.documentElement.style.overflow = '';
    // Focus restoration is the browser's job with a native dialog, so there is
    // deliberately nothing to do here.
  }

  async function toggleFullscreen() {
    if (!dialog) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await dialog.requestFullscreen();
    } catch {
      // Fullscreen can be refused (iOS Safari, permissions policy). The
      // lightbox already fills the viewport, so this is an enhancement only.
    }
  }

  // --- gesture -------------------------------------------------------------
  let startX = 0;
  let startOffset = 0;
  let samples: { x: number; t: number }[] = [];
  let committed = false;

  function onPointerDown(event: PointerEvent) {
    if (!multiple || reduceMotion || event.button !== 0 || dragging) return;
    dragging = true;
    committed = false;
    startX = event.clientX;
    startOffset = offset;
    samples = [{ x: event.clientX, t: performance.now() }];
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    velocity = 0;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // tracking still works inside the element without capture
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const delta = event.clientX - startX;
    if (!committed) {
      if (Math.abs(delta) < 10) return;
      committed = true;
    }
    offset = clampWithRubberband(startOffset + delta, -(count - 1) * width, 0, width);
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
      // never captured
    }
    if (!committed) return;
    const releaseVelocity = velocityFrom(samples);
    goTo(snapTarget(offset, releaseVelocity, width, count), releaseVelocity);
  }

  function onKeyDown(event: KeyboardEvent) {
    // Escape belongs to the dialog itself; intercepting it would only risk
    // breaking behaviour the platform already gets right.
    if (event.key === 'ArrowLeft' && multiple) {
      event.preventDefault();
      goPrev();
    } else if (event.key === 'ArrowRight' && multiple) {
      event.preventDefault();
      goNext();
    } else if (event.key === 'Home') {
      event.preventDefault();
      goTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      goTo(count - 1);
    }
  }

  function measure() {
    if (!stage) return;
    const measured = stage.getBoundingClientRect().width;
    if (measured > 0) width = measured;
  }

  // --- lifecycle -----------------------------------------------------------
  $effect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = query.matches;
    const onMotionChange = (e: MediaQueryListEvent) => (reduceMotion = e.matches);
    query.addEventListener('change', onMotionChange);

    const onFullscreenChange = () => (isFullscreen = Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const onResize = () => {
      measure();
      offset = -index * width;
      target = offset;
      applyTransform();
    };
    window.addEventListener('resize', onResize);

    return () => {
      query.removeEventListener('change', onMotionChange);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('resize', onResize);
      if (frame) cancelAnimationFrame(frame);
      document.documentElement.style.overflow = '';
    };
  });
</script>

<!-- Thumbnail grid. Real links, so this works with no JavaScript at all. -->
<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3">
  {#each images as image, i (image.src)}
    <li class="min-w-0">
      <a
        href={image.src}
        onclick={(event) => openAt(i, event)}
        class="pressable group relative block overflow-hidden rounded-lg border border-line bg-surface-2"
        aria-label={`Open image ${i + 1} of ${count}: ${image.alt}`}
      >
        <img
          src={image.src}
          alt={image.alt}
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
          class="aspect-[3/2] w-full object-cover transition-[filter] duration-200 ease-out group-hover:brightness-110"
        />
      </a>
    </li>
  {/each}
</ul>

<dialog
  bind:this={dialog}
  onclose={onDialogClose}
  onkeydown={onKeyDown}
  aria-label="Photo gallery"
  class="lightbox"
>
  {#if open && current}
    <div class="flex h-full w-full flex-col">
      <div class="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <p class="type-data text-sm tabular-nums text-white/70">
          {index + 1} <span class="text-white/40">/</span>
          {count}
        </p>

        <div class="flex items-center gap-1">
          <button
            type="button"
            class="lightbox-button"
            onclick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
            aria-pressed={isFullscreen}
          >
            {#if isFullscreen}
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 3v4a2 2 0 0 1-2 2H3M21 9h-4a2 2 0 0 1-2-2V3M3 15h4a2 2 0 0 1 2 2v4M15 21v-4a2 2 0 0 1 2-2h4" />
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4" />
              </svg>
            {/if}
          </button>

          <button type="button" class="lightbox-button" onclick={close} aria-label="Close gallery">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div
        bind:this={stage}
        class="relative min-h-0 flex-1 overflow-hidden"
        class:cursor-grab={multiple && !reduceMotion && !dragging}
        class:cursor-grabbing={dragging}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        style="touch-action: pan-y;"
      >
        <div bind:this={track} class="flex h-full" style="will-change: transform;">
          {#each images as image, i (image.src)}
            <div class="flex h-full w-full shrink-0 items-center justify-center px-4 sm:px-16">
              <img
                src={image.src}
                alt={image.alt}
                width={image.width}
                height={image.height}
                draggable="false"
                loading={Math.abs(i - index) <= 1 ? 'eager' : 'lazy'}
                decoding="async"
                class="max-h-full max-w-full select-none object-contain"
                style={`opacity: ${reduceMotion && i !== index ? 0 : 1}; transition: opacity 200ms ease-out;`}
              />
            </div>
          {/each}
        </div>

        {#if multiple}
          <button
            type="button"
            class="lightbox-arrow left-2 sm:left-4"
            onclick={goPrev}
            disabled={index === 0}
            aria-label="Previous image"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            class="lightbox-arrow right-2 sm:right-4"
            onclick={goNext}
            disabled={index === count - 1}
            aria-label="Next image"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        {/if}
      </div>

      <div class="shrink-0 px-4 py-4 sm:px-6">
        <div class="mx-auto max-w-3xl">
          {#if current.caption}
            <p class="text-sm leading-relaxed text-white/85">{current.caption}</p>
          {/if}
          <p class="mt-1.5 text-xs leading-relaxed text-white/55">
            {#if current.author}
              <span class={current.attributionRequired ? 'text-white/75' : ''}>{current.author}</span>
              ·
            {/if}
            {#if current.licenseUrl}
              <a class="underline underline-offset-2 hover:text-white" href={current.licenseUrl} rel="nofollow noopener" target="_blank">{current.licenseLabel}</a>
            {:else}
              {current.licenseLabel}
            {/if}
            ·
            <a class="underline underline-offset-2 hover:text-white" href={current.sourceUrl} rel="nofollow noopener" target="_blank">Source</a>
          </p>
          {#if current.licenseNote}
            <p class="mt-1 text-xs leading-relaxed text-white/40">{current.licenseNote}</p>
          {/if}
        </div>
      </div>

      {#if multiple}
        <div class="shrink-0 overflow-x-auto px-4 pb-4 sm:px-6">
          <ol class="mx-auto flex w-max gap-2">
            {#each images as image, i (image.src)}
              <li>
                <button
                  type="button"
                  onclick={() => goTo(i)}
                  aria-label={`Show image ${i + 1}`}
                  aria-current={i === index ? 'true' : undefined}
                  class="block size-12 overflow-hidden rounded border transition-[opacity,border-color] duration-150 ease-out"
                  style={`opacity: ${i === index ? 1 : 0.45}; border-color: ${i === index ? '#fff' : 'rgba(255,255,255,0.25)'};`}
                >
                  <img src={image.src} alt="" loading="lazy" decoding="async" class="size-full object-cover" />
                </button>
              </li>
            {/each}
          </ol>
        </div>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  /*
   * A native modal dialog is centred and auto-sized by the UA, and Tailwind's
   * preflight resets `margin: 0`. A lightbox wants the whole viewport anyway,
   * so both are set explicitly rather than inherited.
   */
  .lightbox {
    width: 100vw;
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0;
    padding: 0;
    border: 0;
    /* Opaque, not translucent. A photo viewer's job is to remove everything
       competing with the photograph; page text ghosting through behind it is
       exactly the distraction the lightbox exists to eliminate. */
    background-color: rgb(9 11 14);
    color: #fff;

    opacity: 0;
    transform: scale(0.97);
    transition:
      opacity 180ms var(--ease-out-strong),
      transform 180ms var(--ease-out-strong),
      overlay 180ms allow-discrete,
      display 180ms allow-discrete;
  }

  .lightbox[open] {
    opacity: 1;
    transform: scale(1);
  }

  /* Nothing appears from nothing — enter from 0.97, never from zero. */
  @starting-style {
    .lightbox[open] {
      opacity: 0;
      transform: scale(0.97);
    }
  }

  .lightbox::backdrop {
    background-color: rgb(0 0 0 / 0.7);
  }

  .lightbox-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 9999px;
    border: 1px solid rgb(255 255 255 / 0.15);
    background-color: rgb(255 255 255 / 0.08);
    color: rgb(255 255 255 / 0.85);
    transition:
      background-color 150ms var(--ease-out-strong),
      transform 150ms var(--ease-out-strong);
  }

  .lightbox-button:hover {
    background-color: rgb(255 255 255 / 0.16);
    color: #fff;
  }

  .lightbox-button:active {
    transform: scale(0.94);
  }

  .lightbox-arrow {
    position: absolute;
    top: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    margin-top: -1.375rem;
    border-radius: 9999px;
    border: 1px solid rgb(255 255 255 / 0.15);
    background-color: rgb(0 0 0 / 0.45);
    color: rgb(255 255 255 / 0.9);
    backdrop-filter: blur(8px);
    transition:
      background-color 150ms var(--ease-out-strong),
      opacity 150ms var(--ease-out-strong),
      transform 150ms var(--ease-out-strong);
  }

  .lightbox-arrow:hover:not(:disabled) {
    background-color: rgb(0 0 0 / 0.7);
  }

  .lightbox-arrow:active:not(:disabled) {
    transform: scale(0.94);
  }

  .lightbox-arrow:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .lightbox :global(:focus-visible) {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .lightbox,
    .lightbox[open] {
      transform: none;
    }
    .lightbox-button:active,
    .lightbox-arrow:active:not(:disabled) {
      transform: none;
    }
  }
</style>
