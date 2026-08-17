<script lang="ts">
  /**
   * Theme control — System / Light / Dark.
   *
   * **Three states, not a two-way switch.** "System" is the default and is a
   * real option, not the absence of one: it keeps following the OS, so a
   * machine that switches at sunset takes the site with it. A binary toggle
   * silently converts every visitor into an explicit choice the moment they
   * touch it, and they can never get back to "just do what my computer does".
   *
   * **No animation.** review-animations/STANDARDS.md is explicit that
   * frequently-used, keyboard-reachable controls should not animate — motion
   * here would make a instant state change feel slow. The only movement is the
   * standard press feedback every button on the site has.
   *
   * Rendered as a radiogroup rather than a cycling button so all three states
   * are visible and directly reachable, and so a screen reader announces which
   * one is active instead of "button, theme".
   */
  import { read, write } from '../../lib/storage/index.ts';
  import {
    applyTheme,
    isThemePreference,
    resolveTheme,
    THEME_FEATURE,
    THEME_ORDER,
    THEME_VERSION,
    type ResolvedTheme,
    type ThemePreference,
  } from '../../lib/theme.ts';

  let preference = $state<ThemePreference>('system');
  let resolved = $state<ResolvedTheme>('light');
  let notice = $state<string | null>(null);

  const LABELS: Record<ThemePreference, string> = {
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  };

  function choose(next: ThemePreference) {
    preference = next;
    applyTheme(next);
    resolved = resolveTheme(next);

    const result = write(THEME_FEATURE, THEME_VERSION, next);
    // SPEC.md §9.8: a failure to remember is surfaced, never swallowed. The
    // theme still applies for this page — only the persistence failed.
    notice = result.ok ? null : result.message;
  }

  $effect(() => {
    const stored = read(THEME_FEATURE, THEME_VERSION, isThemePreference);
    if (stored.ok) preference = stored.data;
    resolved = resolveTheme(preference);

    // Marking the document ready enables the short tint transition, so the
    // *initial* paint is never animated — only subsequent changes.
    document.documentElement.classList.add('theme-ready');

    // While on "system", keep following the OS as it changes.
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (preference === 'system') resolved = resolveTheme('system');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  });
</script>

<div class="flex items-center gap-2">
  <div
    role="radiogroup"
    aria-label="Colour theme"
    class="flex items-center gap-0.5 rounded-full border border-line bg-surface-1 p-0.5"
  >
    {#each THEME_ORDER as option (option)}
      <button
        type="button"
        role="radio"
        aria-checked={preference === option}
        aria-label={`${LABELS[option]} theme${option === 'system' ? ` (currently ${resolved})` : ''}`}
        title={option === 'system' ? `Follow the system — currently ${resolved}` : LABELS[option]}
        class="pressable inline-flex size-7 items-center justify-center rounded-full text-ink-secondary transition-colors duration-150 hover:text-ink"
        style={preference === option
          ? 'background-color: var(--color-surface-3); color: var(--color-ink);'
          : ''}
        onclick={() => choose(option)}
      >
        {#if option === 'system'}
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        {:else if option === 'light'}
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
        {/if}
      </button>
    {/each}
  </div>

  {#if notice}
    <p class="max-w-[14rem] text-xs leading-tight text-ink-muted" role="status">{notice}</p>
  {/if}
</div>
