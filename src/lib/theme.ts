/**
 * Theme selection — light, dark, or follow the system.
 *
 * Three states, not two. "Dark" and "light" are explicit choices; **"system" is
 * the default and is genuinely different from either** — it keeps tracking the
 * OS, so a visitor whose machine switches at sunset gets a site that switches
 * with it. A two-state toggle silently converts everyone into an explicit
 * choice the first time they touch it, which is worse than it sounds: it means
 * the site stops respecting a preference the reader set once for everything.
 *
 * The storage key and the DOM contract live here so the blocking head script,
 * the toggle island, and the CSS all agree on them. The head script cannot
 * import this module — it has to run before any module loads, or the page
 * paints in the wrong theme first — so it reimplements the three lines it
 * needs, and this file is where the shape they duplicate is defined.
 */
import { NAMESPACE } from './storage/index.ts';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_FEATURE = 'theme';
export const THEME_VERSION = 1;

/** `markey:theme:v1`. Duplicated literally in the head script — keep in sync. */
export const THEME_STORAGE_KEY = `${NAMESPACE}:${THEME_FEATURE}:v${THEME_VERSION}`;

export const THEME_ORDER: ThemePreference[] = ['system', 'light', 'dark'];

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** What a preference actually resolves to right now. */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies a preference to the document.
 *
 * Sets `data-theme` for the CSS, and `color-scheme` so the **browser's own**
 * surfaces follow too — scrollbars, form controls, the spellcheck underline,
 * date pickers. Skipping `color-scheme` is the classic half-done dark mode:
 * the page goes dark and the scrollbar stays white.
 *
 * `system` removes the attribute entirely rather than writing a resolved value,
 * so the media query stays in charge and the page keeps tracking the OS.
 */
export function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  if (preference === 'system') {
    root.removeAttribute('data-theme');
    root.style.colorScheme = 'light dark';
  } else {
    root.setAttribute('data-theme', preference);
    root.style.colorScheme = preference;
  }
}

/**
 * The inline script that runs before first paint.
 *
 * Exported as a string so it can be injected into `<head>` ahead of any
 * stylesheet or module. Without it the page paints in the default theme and
 * then snaps to the stored one — the flash of wrong theme, which is far more
 * jarring in the light→dark direction than most people expect.
 *
 * Deliberately tiny, dependency-free, and wrapped in try/catch: it runs
 * render-blocking on every page, and a throw here would leave the document
 * unstyled.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var k=${JSON.stringify(THEME_STORAGE_KEY)};
var raw=localStorage.getItem(k);
var p='system';
if(raw){var e=JSON.parse(raw);if(e&&e.v===${THEME_VERSION}&&(e.data==='light'||e.data==='dark'||e.data==='system'))p=e.data;}
var r=document.documentElement;
if(p==='system'){r.removeAttribute('data-theme');r.style.colorScheme='light dark';}
else{r.setAttribute('data-theme',p);r.style.colorScheme=p;}
}catch(_){}})();`;
