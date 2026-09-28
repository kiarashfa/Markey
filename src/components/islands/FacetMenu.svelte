<script lang="ts">
  /**
   * One multi-select filter menu in the catalog's toolbar.
   *
   * A sidebar of open checkbox lists grew with every term the catalog gained,
   * and brands alone will run to hundreds. A menu is one button however many
   * terms it holds: its list scrolls on its own, and past ten terms it can be
   * searched. Escape closes it and returns focus; a click outside dismisses it.
   *
   * The counts say how many cars each term would leave given every OTHER
   * active filter, so a choice that empties the list is visible before it is
   * made. Terms arrive already ordered by the caller.
   */
  interface Term {
    id: string;
    label: string;
  }

  interface Props {
    label: string;
    terms: readonly Term[];
    selected: string[];
    onchange: (next: string[]) => void;
    counts?: Record<string, number>;
    /** Stretch to fill the slot the toolbar gives it. */
    fill?: boolean;
  }

  const { label, terms, selected, onchange, counts, fill = false }: Props = $props();

  const SEARCH_FROM = 10;

  let open = $state(false);
  let filter = $state('');
  let root = $state<HTMLElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);

  const visible = $derived(
    filter.trim() === ''
      ? terms
      : terms.filter((t) => t.label.toLowerCase().includes(filter.trim().toLowerCase())),
  );

  const toggle = (id: string) =>
    onchange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  function close(refocus = false) {
    open = false;
    filter = '';
    if (refocus) button?.focus();
  }

  $effect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class={`relative max-sm:static ${fill ? 'min-w-0 sm:flex-1' : ''}`} bind:this={root}>
  <button
    type="button"
    bind:this={button}
    aria-expanded={open}
    aria-haspopup="true"
    onclick={() => (open ? close() : (open = true))}
    class={`pressable inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-colors duration-150 ${fill ? 'w-full justify-between' : ''} ${
      selected.length > 0
        ? 'border-[var(--brand-accent)] bg-surface-2 text-ink'
        : 'border-line text-ink-secondary hover:border-line-strong hover:text-ink'
    }`}
  >
    <span class="truncate">{label}</span>
    {#if selected.length > 0}
      <span class="rounded-full bg-[var(--brand-accent)] px-1.5 text-[11px] leading-[1.4] text-white tabular-nums"
        >{selected.length}</span
      >
    {/if}
    <span aria-hidden="true" class="text-[9px] opacity-70">▾</span>
  </button>

  {#if open}
    <div
      role="group"
      aria-label={label}
      class="absolute left-0 top-[calc(100%+6px)] z-30 flex max-h-[min(380px,70vh)] w-max min-w-[230px] max-w-[min(320px,calc(100vw-2.5rem))] flex-col rounded-xl border border-line-strong bg-surface-1 p-2 shadow-xl max-sm:right-0 max-sm:w-auto max-sm:max-w-none"
    >
      {#if terms.length > SEARCH_FROM}
        <input
          type="search"
          bind:value={filter}
          placeholder={`Find a ${label.toLowerCase()}`}
          aria-label={`Find a ${label.toLowerCase()}`}
          class="mb-1.5 w-full shrink-0 rounded-lg border border-line bg-surface-0 px-2.5 py-2 text-sm placeholder:text-ink-muted focus:border-line-strong focus:outline-none"
        />
      {/if}
      <ul class="min-h-0 overflow-y-auto overscroll-contain">
        {#each visible as term (term.id)}
          {@const n = counts?.[term.id]}
          <li>
            <label
              class={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 hover:bg-surface-2 ${
                n === 0 && !selected.includes(term.id) ? 'opacity-45' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={selected.includes(term.id)}
                onchange={() => toggle(term.id)}
                class="size-3.5 shrink-0 accent-[var(--brand-accent)]"
              />
              <span class="min-w-0 flex-1">{term.label}</span>
              {#if n !== undefined}<span class="shrink-0 text-xs tabular-nums text-ink-muted">{n}</span>{/if}
            </label>
          </li>
        {:else}
          <li class="px-2 py-2 text-sm text-ink-muted">Nothing matches “{filter}”.</li>
        {/each}
      </ul>
      {#if selected.length > 0}
        <button
          type="button"
          onclick={() => onchange([])}
          class="mt-1.5 shrink-0 border-t border-line px-2 pt-2 text-left text-xs text-ink-muted hover:text-ink"
        >
          Clear {label.toLowerCase()}
        </button>
      {/if}
    </div>
  {/if}
</div>
