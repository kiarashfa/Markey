<script lang="ts">
  /**
   * A set of choices, as cards rather than as pills.
   *
   * A row of unlabelled capsules asks the visitor to already know what each
   * word means and what picking it would do. These cards carry the taxonomy's
   * own description and, where the caller can supply one, the number of entries
   * behind the choice — so "Liftback" is a decision rather than a guess, and a
   * filter that would empty the list says so before it is pressed.
   *
   * **A zero-count option is shown, disabled, not hidden.** Hiding it would
   * quietly misrepresent the catalogue as containing only what we happen to
   * have; showing it greyed says "this exists, we have none yet", which is the
   * same honesty rule the spec tables follow for a missing figure.
   */

  export interface Option {
    id: string;
    label: string;
    /** One line saying what this is. */
    detail?: string;
    /** Entries behind it. `undefined` means the caller has no count to give. */
    count?: number;
    /** A compact figure line, for choices that are mostly numbers. */
    meta?: string;
  }

  interface Props {
    options: Option[];
    /** Selected ids. Single-select callers pass an array of length 0 or 1. */
    selected: string[];
    multiple?: boolean;
    /**
     * How many columns at the widest breakpoint. `1` is for a card sitting in
     * a sidebar, where two columns would be two very narrow ones.
     */
    columns?: 1 | 2 | 3;
    onToggle: (id: string) => void;
    /** Announced to assistive tech as the group's name. */
    label: string;
  }

  let { options, selected, multiple = true, columns = 3, onToggle, label }: Props = $props();

  const isEmpty = (option: Option) => option.count === 0;
</script>

<div
  role={multiple ? 'group' : 'radiogroup'}
  aria-label={label}
  class="grid gap-2 {columns === 1
    ? 'sm:grid-cols-2 lg:grid-cols-1'
    : columns === 2
      ? 'sm:grid-cols-2'
      : 'sm:grid-cols-2 lg:grid-cols-3'}"
>
  {#each options as option (option.id)}
    {@const active = selected.includes(option.id)}
    {@const empty = isEmpty(option)}
    <button
      type="button"
      role={multiple ? 'checkbox' : 'radio'}
      aria-checked={active}
      disabled={empty}
      onclick={() => onToggle(option.id)}
      class="pressable group flex min-w-0 flex-col items-start rounded-lg border p-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 {active
        ? 'border-[var(--brand-accent)] bg-[var(--brand-accent)]/10'
        : 'border-line bg-surface-1 hover:border-line-strong hover:bg-surface-2'}"
    >
      <span class="flex w-full items-baseline justify-between gap-2">
        <span class="min-w-0 truncate text-sm font-medium">{option.label}</span>
        {#if option.count !== undefined}
          <span class="type-data shrink-0 text-xs tabular-nums text-ink-muted">
            {option.count}
          </span>
        {/if}
      </span>

      {#if option.meta}
        <span class="type-data mt-1.5 text-xs tabular-nums text-ink-secondary">{option.meta}</span>
      {/if}

      {#if option.detail}
        <span class="mt-1.5 text-xs leading-relaxed text-ink-muted">{option.detail}</span>
      {/if}

      {#if empty}
        <span class="mt-1.5 text-[0.6875rem] uppercase tracking-wide text-ink-muted">
          None in the catalog yet
        </span>
      {/if}
    </button>
  {/each}
</div>
