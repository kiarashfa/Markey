/**
 * Markey's brand assets: what `build.mjs` draws. Everything site-specific
 * lives here; the layout it is poured into is shared with the other three sites.
 *
 * Colours are the light theme's tokens from `src/styles/global.css`, converted
 * from oklch to hex because the card is rendered outside the browser. Re-run
 * `npm run brand` after changing any of them.
 */
const fontsource = (pkg, file) => `node_modules/@fontsource/${pkg}/files/${file}`;

export default {
  name: 'Markey',
  url: 'kiarashfa.github.io/Markey',
  tagline: 'An encyclopedia of production cars where every figure is sourced and every gap is shown.',

  wordmark: [{ text: 'Markey', weight: 700 }],

  cardTheme: 'light',
  colors: {
    background: '#fbfcfd',
    ink: '#171b20',
    inkSoft: '#4f5359',
    muted: '#62666d',
    line: '#cbced2',
    accent: '#2a75ba',
  },

  fonts: {
    display: {
      family: 'Barlow Semi Condensed',
      weight: 700,
      tracking: -1,
      files: [{ path: fontsource('barlow-semi-condensed', 'barlow-semi-condensed-latin-700-normal.woff'), weight: 700 }],
    },
    body: {
      family: 'Barlow',
      files: [
        { path: fontsource('barlow', 'barlow-latin-400-normal.woff'), weight: 400 },
        { path: fontsource('barlow', 'barlow-latin-600-normal.woff'), weight: 600 },
      ],
    },
  },

  /**
   * The favicon switches its ink with a media query, which a rasteriser does
   * not evaluate. Resolve it for the theme being drawn.
   */
  mark(svg, theme) {
    const ink = theme === 'dark' ? '#f0f2f4' : '#171b20';
    return svg.replace(/<style>[\s\S]*?<\/style>/, '').replaceAll('var(--ink)', ink);
  },
};
