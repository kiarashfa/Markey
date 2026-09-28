<script lang="ts">
  /**
   * One bay in the garage.
   *
   * ## Built to be re-skinned
   *
   * Game garage screens (the GTA/Forza reference) share a
   * structure worth copying: **the empty slot is drawn, not absent.** That is
   * what makes a collection read as a *space* you are filling rather than a
   * list that happens to be short, and it is why the capacity tier feels like a
   * garage rather than a quota.
   *
   * Because a richer visual treatment is expected later, this component is
   * split into two deliberately independent layers:
   *
   *   **The stage** — the area the car occupies. Today a photograph on a tinted
   *   ground. Later it could be a 3D render, a turntable, a lighting rig. It is
   *   a single positioned box with nothing else inside it.
   *
   *   **The chrome** — slot number, badges, actions. Positioned *over* the
   *   stage, never inside it, so the stage can be replaced wholesale without
   *   touching any of it.
   *
   * Geometry comes from CSS custom properties rather than utility classes, so
   * a future redesign changes tokens instead of markup.
   */
  interface Props {
    slot: number;
    /** Absent for an empty bay. */
    car?: {
      uid: string;
      name: string;
      brandName: string;
      accentColor: string;
      heroSrc: string | null;
      heroSrcset?: string | null;
      nickname?: string;
      owned: boolean;
      url: string;
    };
    selected?: boolean;
    onSelect?: () => void;
  }

  let { slot, car, selected = false, onSelect }: Props = $props();
</script>

<div
  class="garage-slot"
  class:is-empty={!car}
  class:is-selected={selected}
  style={car ? `--slot-accent: ${car.accentColor};` : ''}
>
  <button
    type="button"
    class="slot-hit"
    onclick={onSelect}
    aria-label={car
      ? `Bay ${slot + 1}: ${car.nickname ?? car.name}${car.owned ? ', owned' : ''}`
      : `Bay ${slot + 1}, empty`}
    aria-pressed={selected}
  >
    <!-- STAGE: everything a future visual treatment would replace. -->
    <span class="slot-stage" aria-hidden="true">
      {#if car?.heroSrc}
        <img src={car.heroSrc} srcset={car.heroSrcset ?? undefined} sizes="(min-width: 40rem) 22vw, 45vw" alt="" loading="lazy" decoding="async" class="slot-photo" />
      {:else if car}
        <span class="slot-nophoto">No photograph yet</span>
      {/if}
    </span>

    <!-- CHROME: sits above the stage and is independent of it. -->
    <span class="slot-chrome" aria-hidden="true">
      <span class="slot-number">{String(slot + 1).padStart(2, '0')}</span>
      {#if car?.owned}
        <span class="slot-badge">Owned</span>
      {/if}
    </span>

    {#if car}
      <span class="slot-label">
        <span class="slot-name">{car.nickname ?? car.name}</span>
        <span class="slot-brand">{car.brandName}</span>
      </span>
    {/if}
  </button>
</div>

<style>
  .garage-slot {
    /* Geometry as tokens: a redesign edits these, not the markup. */
    --slot-aspect: 4 / 3;
    --slot-radius: 0.75rem;
    --slot-accent: var(--color-line-strong);

    position: relative;
    min-width: 0;
  }

  .slot-hit {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: var(--slot-aspect);
    overflow: hidden;
    border-radius: var(--slot-radius);
    border: 1px solid var(--color-line);
    background-color: var(--color-surface-1);
    text-align: left;
    transition:
      border-color 150ms var(--ease-out-strong),
      transform 150ms var(--ease-out-strong);
  }

  .slot-hit:hover {
    border-color: var(--color-line-strong);
  }

  .slot-hit:active {
    transform: scale(0.985);
  }

  .is-selected .slot-hit {
    border-color: var(--slot-accent);
    box-shadow: 0 0 0 1px var(--slot-accent);
  }

  /* An empty bay is drawn, not omitted — it is the invitation to fill it. */
  .is-empty .slot-hit {
    border-style: dashed;
    background-color: color-mix(in oklab, var(--color-surface-1) 60%, transparent);
  }

  .is-empty .slot-hit::after {
    content: '+';
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 1.5rem;
    line-height: 1;
    color: var(--color-ink-muted);
    opacity: 0.5;
  }

  .is-empty .slot-hit:hover::after {
    opacity: 0.9;
  }

  /* --- stage ------------------------------------------------------------ */
  .slot-stage {
    position: absolute;
    inset: 0;
    display: block;
    background: linear-gradient(
      165deg,
      color-mix(in oklab, var(--slot-accent) 22%, var(--color-surface-1)) 0%,
      var(--color-surface-1) 75%
    );
  }

  .slot-photo {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .slot-nophoto {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 0 1rem;
    text-align: center;
    font-size: 0.6875rem;
    color: var(--color-ink-muted);
  }

  /* --- chrome ----------------------------------------------------------- */
  .slot-chrome {
    position: absolute;
    inset-block-start: 0.5rem;
    inset-inline: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    pointer-events: none;
  }

  .slot-number {
    display: inline-flex;
    align-items: center;
    border-radius: 0.25rem;
    padding: 0.125rem 0.375rem;
    background-color: color-mix(in oklab, var(--color-surface-0) 82%, transparent);
    color: var(--color-ink-secondary);
    font-size: 0.625rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.06em;
    backdrop-filter: blur(4px);
  }

  .slot-badge {
    display: inline-flex;
    align-items: center;
    border-radius: 9999px;
    padding: 0.125rem 0.5rem;
    background-color: var(--slot-accent);
    color: #fff;
    font-size: 0.5625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .slot-label {
    position: absolute;
    inset-block-end: 0;
    inset-inline: 0;
    display: flex;
    flex-direction: column;
    gap: 0.0625rem;
    padding: 1.75rem 0.625rem 0.5rem;
    background: linear-gradient(to top, rgb(0 0 0 / 0.72), transparent);
    color: #fff;
  }

  .slot-name {
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slot-brand {
    font-size: 0.625rem;
    opacity: 0.75;
  }

  @media (prefers-reduced-motion: reduce) {
    .slot-hit:active {
      transform: none;
    }
  }
</style>
