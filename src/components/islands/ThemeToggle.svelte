<script lang="ts">
  /**
   * Theme control — System / Light / Dark, as one cycling button.
   *
   * **Three states, not a two-way switch.** "System" is the default and is a
   * real option, not the absence of one: it keeps following the OS, so a
   * machine that switches at sunset takes the site with it. A binary toggle
   * silently converts every visitor into an explicit choice the moment they
   * touch it, and they can never get back to "just do what my computer does".
   *
   * **One button rather than a radiogroup.** The radiogroup showed all three
   * states at once and made every one directly reachable, which is genuinely
   * better on its own terms — but it cost three slots in a header that has more
   * important things to put there. A cycling button is the standard idiom for
   * exactly this, and the accessibility cost is recoverable: the button
   * announces its current state *and* what pressing it will do, so a screen
   * reader user is never guessing, and reaching any state takes at most two
   * presses.
   *
   * **No animation.** review-animations/STANDARDS.md is explicit that
   * frequently-used, keyboard-reachable controls should not animate — motion
   * here would make an instant state change feel slow. The only movement is the
   * standard press feedback every button on the site has.
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

  /** The next state in the cycle — System → Light → Dark → System. */
  const next = $derived(
    THEME_ORDER[(THEME_ORDER.indexOf(preference) + 1) % THEME_ORDER.length] ?? 'system',
  );

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
  <button
    type="button"
    class="pressable inline-flex size-8 items-center justify-center rounded-full border border-line bg-surface-1 text-ink-secondary transition-colors duration-150 hover:border-line-strong hover:text-ink"
    aria-label={`Colour theme: ${LABELS[preference]}${
      preference === 'system' ? ` (currently ${resolved})` : ''
    }. Switch to ${LABELS[next]}.`}
    title={`Theme: ${LABELS[preference]}${
      preference === 'system' ? ` — currently ${resolved}` : ''
    }. Click for ${LABELS[next]}.`}
    onclick={() => choose(next)}
  >
    {#if preference === 'system'}
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    {:else if preference === 'light'}
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    {:else}
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    {/if}
  </button>

  <!--
    A live region rather than a visible label: the icon changes on every press,
    and a screen reader needs to hear *which* state it landed in without the
    sighted layout paying for a word that the icon already says.
  -->
  <span class="sr-only" role="status">
    Theme: {LABELS[preference]}{preference === 'system' ? ` — currently ${resolved}` : ''}
  </span>

  {#if notice}
    <p class="max-w-[14rem] text-xs leading-tight text-ink-muted" role="status">{notice}</p>
  {/if}
</div>
