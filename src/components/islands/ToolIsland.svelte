<script lang="ts" module>
  import type { CatalogueCar } from '../../lib/content/catalogue.ts';

  /**
   * One request for the whole catalogue, however many tools read it in a
   * session: the promise is shared within the page and the browser cache
   * shares the file across pages.
   */
  let pending: Promise<CatalogueCar[]> | null = null;
  function loadCatalogue(src: string): Promise<CatalogueCar[]> {
    pending ??= fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ cars: CatalogueCar[] }>;
      })
      .then((body) => body.cars)
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  }

  const TOOLS = {
    compare: () => import('./CompareTool.svelte'),
    garage: () => import('./MyGarage.svelte'),
    matchmaker: () => import('./Matchmaker.svelte'),
    'guided-browse': () => import('./GuidedBrowse.svelte'),
  } as const;
  export type ToolName = keyof typeof TOOLS;
</script>

<script lang="ts">
  /**
   * The shell every catalogue-wide tool renders in.
   *
   * The tools need every car, and embedding the catalogue in each page made
   * four pages of 700–900 KB that all carried the same data. Instead the page
   * ships this shell, which fetches `/catalogue.json` (the public export, so it
   * is always the same data the car pages render) and then loads the tool's own
   * code. The reserved height keeps the page below from jumping when it lands.
   */
  import type { Component } from 'svelte';

  let {
    tool,
    src,
    props = {},
  }: { tool: ToolName; src: string; props?: Record<string, unknown> } = $props();

  let View = $state<Component<any> | null>(null);
  let cars = $state<CatalogueCar[] | null>(null);
  let failed = $state(false);

  function start() {
    failed = false;
    Promise.all([loadCatalogue(src), TOOLS[tool]()])
      .then(([loaded, module]) => {
        cars = loaded;
        View = module.default as Component<any>;
      })
      .catch(() => {
        failed = true;
      });
  }

  $effect(() => {
    start();
  });
</script>

{#if View && cars}
  <View {cars} {...props} />
{:else if failed}
  <div class="rounded-lg border border-line p-6 text-center" role="alert">
    <p class="type-body text-ink-secondary">The catalogue could not be loaded.</p>
    <button
      type="button"
      class="mt-3 rounded-full border border-line px-4 py-1.5 text-sm text-ink hover:border-ink-muted"
      onclick={start}
    >
      Try again
    </button>
  </div>
{:else}
  <div class="tool-loading" aria-busy="true" aria-live="polite">
    <span class="sr-only">Loading the catalogue</span>
    <div class="tool-loading-bar"></div>
    <div class="tool-loading-bar w-2/3"></div>
    <div class="tool-loading-block"></div>
  </div>
{/if}

<style>
  .tool-loading {
    display: grid;
    gap: 0.75rem;
    min-height: 24rem;
    align-content: start;
  }
  .tool-loading-bar,
  .tool-loading-block {
    border-radius: 0.5rem;
    background: var(--color-surface-2);
    animation: tool-pulse 1.4s ease-in-out infinite;
  }
  .tool-loading-bar {
    height: 2.5rem;
  }
  .tool-loading-block {
    height: 16rem;
  }
  @keyframes tool-pulse {
    50% {
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tool-loading-bar,
    .tool-loading-block {
      animation: none;
    }
  }
</style>
