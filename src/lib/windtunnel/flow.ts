/**
 * How the flow is shown, and how it is coloured.
 *
 * ## One vocabulary, three consumers
 *
 * The renderer needs to know which pass to run, the UI needs labels and
 * explanations, and the shaders need integer constants. Splitting those across
 * three files is how a menu ends up offering a mode the renderer does not have.
 * They are declared once here, and the GLSL constants are *emitted* from the
 * same objects the UI reads.
 *
 * ## What each mode answers
 *
 * The five are not five skins on one picture. Each answers a different question,
 * and the descriptions below are the ones the UI shows, because a visitor who
 * does not know what a streakline is cannot choose between them otherwise.
 */

export const FLOW_MODES = [
  {
    id: 'ribbon',
    label: 'Ribbons',
    question: 'Where does the air go?',
    detail:
      'Continuous filaments from a rake of nozzles, exactly as a tunnel makes ' +
      'them. Follow one and you can see where it stays attached, where it lifts ' +
      'off, and where it is drawn back into the wake.',
  },
  {
    id: 'smoke',
    label: 'Smoke',
    question: 'Where is the air disturbed?',
    detail:
      'A cloud released at the rake and carried by the flow. It fills the ' +
      'separated regions in a way discrete filaments cannot, so the size and ' +
      'shape of the wake read at a glance.',
  },
  {
    id: 'mist',
    label: 'Mist',
    question: 'What is the whole field doing?',
    detail:
      'Thousands of short-lived tracers rather than a few long ones. Individual ' +
      'paths are lost, but the texture of the field (where it is fast, where it ' +
      'is churning) is visible everywhere at once.',
  },
  {
    id: 'wake',
    label: 'Wake',
    question: 'How big is the hole it drags?',
    detail:
      'The region where the air has been slowed or reversed, drawn as a solid ' +
      'volume. This is the pressure deficit behind the car, and most of its ' +
      'drag. Nothing is released: it is measured from the velocity field.',
  },
  {
    id: 'pressure',
    label: 'Pressure',
    question: 'Where does the air push?',
    detail:
      'Surface pressure on the bodywork itself, from the solver’s own density ' +
      'field. Red is pushing in, at the stagnation point on the nose. Blue is ' +
      'pulling, in the accelerated flow over the shoulders and roof.',
  },
] as const;

export type FlowModeId = (typeof FLOW_MODES)[number]['id'];

export const COLOR_MODES = [
  { id: 'white', label: 'White', detail: 'Plain smoke, as a tunnel actually looks.' },
  { id: 'speed', label: 'Speed', detail: 'Warm where the air is slowed, cool where it is accelerated.' },
  { id: 'vorticity', label: 'Vorticity', detail: 'Bright where the flow is spinning: shear layers and vortex cores.' },
  { id: 'age', label: 'Age', detail: 'By time since release, so you can read how fast a filament travelled.' },
] as const;

export type ColorModeId = (typeof COLOR_MODES)[number]['id'];

/** Which modes release tracers, which raymarch a volume, and which do neither. */
export const modeUsesTracers = (m: FlowModeId) => m === 'ribbon' || m === 'mist';
export const modeUsesVolume = (m: FlowModeId) => m === 'smoke' || m === 'wake';
export const modeUsesDye = (m: FlowModeId) => m === 'smoke';
export const modeUsesSources = (m: FlowModeId) => m !== 'wake' && m !== 'pressure';

export const flowMode = (id: FlowModeId) => FLOW_MODES.find((m) => m.id === id)!;
export const colorMode = (id: ColorModeId) => COLOR_MODES.find((m) => m.id === id)!;

const colorIndex = (id: ColorModeId) => COLOR_MODES.findIndex((m) => m.id === id);
export const colorModeIndex = colorIndex;

/**
 * Field sampling, in GLSL.
 *
 * The solver decodes its distributions once per step into a single atlas of
 * `(ux, uy, uz, δρ)`, and everything downstream reads that rather than the
 * nineteen populations. Reconstructing a velocity from the populations costs
 * five texture fetches and a nineteen-term sum; a tracer wants four velocities
 * per frame with interpolation, which through the raw populations would be
 * forty fetches for one value.
 *
 * `uField` is half-float and linearly filtered, so x and y interpolate in
 * hardware. The z-slice atlas forbids hardware 3D filtering, so z is blended by
 * hand — without it, everything sampled from the volume stair-steps in z.
 */
export const FIELD_GLSL = `
uniform sampler2D uField;
uniform sampler2D uSolidTex;
uniform vec3 uGrid;
uniform vec2 uTiles;
uniform vec2 uAtlas;
uniform float uVelocity;

/* c is a fractional cell index; the half-texel is added here so a c of 0 lands
   on the first texel's centre and filtering never reaches the neighbouring
   z-tile. */
vec2 cellToUv(vec3 c) {
  float tile = floor(clamp(c.z, 0.0, uGrid.z - 1.0));
  float tx = mod(tile, uTiles.x), ty = floor(tile / uTiles.x);
  vec2 texel = vec2(tx*uGrid.x + clamp(c.x, 0.0, uGrid.x - 1.0) + 0.5,
                    ty*uGrid.y + clamp(c.y, 0.0, uGrid.y - 1.0) + 0.5);
  return texel / uAtlas;
}

bool outsideGrid(vec3 c) {
  return c.x < 0.0 || c.y < 0.0 || c.z < 0.0 ||
         c.x > uGrid.x - 1.0 || c.y > uGrid.y - 1.0 || c.z > uGrid.z - 1.0;
}

/* xyz = velocity in lattice units, w = density deviation from unity. */
vec4 fieldAt(vec3 c) {
  float fz = fract(c.z);
  vec4 a = texture(uField, cellToUv(vec3(c.x, c.y, floor(c.z))));
  vec4 b = texture(uField, cellToUv(vec3(c.x, c.y, floor(c.z) + 1.0)));
  return mix(a, b, fz);
}

bool inSolid(vec3 c) {
  return !outsideGrid(c) && texture(uSolidTex, cellToUv(c)).r > 0.5;
}

vec3 velAt(vec3 c) { return outsideGrid(c) ? vec3(0.0) : fieldAt(c).xyz; }

/** Speed as a fraction of the free stream. */
float speedRatio(vec3 c) { return length(velAt(c)) / max(uVelocity, 1e-6); }

/**
 * Vorticity magnitude by central differences on the decoded field.
 *
 * Six extra samples, so it is only ever evaluated when something asked for it.
 * Normalised by the free stream over one cell, which makes it dimensionless and
 * roughly order one in a shear layer.
 */
float vorticity(vec3 c) {
  vec3 dx = vec3(1.0, 0.0, 0.0), dy = vec3(0.0, 1.0, 0.0), dz = vec3(0.0, 0.0, 1.0);
  vec3 ux = velAt(c + dx) - velAt(c - dx);
  vec3 uy = velAt(c + dy) - velAt(c - dy);
  vec3 uz = velAt(c + dz) - velAt(c - dz);
  vec3 w = 0.5 * vec3(uy.z - uz.y, uz.x - ux.z, ux.y - uy.x);
  return length(w) / max(uVelocity, 1e-6);
}

/**
 * Density of the undisturbed stream, sampled upstream of everything.
 *
 * The whole domain sits at a slightly raised mean density — the body displaces
 * fluid, and the far-field boundaries hold velocity rather than pressure, so
 * the datum drifts. Measured against zero, the free stream came out at Cp ≈ 0.5
 * and every surface read half a bar too high. Cp is *defined* against the
 * static pressure of the undisturbed stream, so that is what it is measured
 * against here, exactly as a tunnel takes its reference from a static tapping
 * ahead of the model.
 */
float freeStreamDensity() {
  return fieldAt(vec3(3.0, uGrid.y * 0.7, uGrid.z * 0.5)).w;
}

/**
 * Pressure coefficient.
 *
 * In a lattice-Boltzmann fluid p = ρ·cs² with cs² = 1/3, so
 * Cp = (p − p∞)/(½ρ∞U²) = 2·(δρ − δρ∞)/(3U²).
 */
float pressureCoefficient(float deltaRho) {
  return (2.0 / 3.0) * (deltaRho - freeStreamDensity()) / max(uVelocity * uVelocity, 1e-9);
}

/**
 * How much this point looks like wake.
 *
 * A dead band, and it matters: every point near a body is slightly slow, and
 * counting all of it made the whole domain fog over — the car disappeared
 * behind its own boundary layer, which is the opposite of what a wake view is
 * for. Only air slowed below three quarters of the free stream counts, and
 * genuinely reversed air counts double.
 */
float wakeAmount(vec3 c) {
  float ux = velAt(c).x / max(uVelocity, 1e-6);
  return smoothstep(0.62, 0.02, ux) + clamp(-ux, 0.0, 1.0);
}
`;

/**
 * The colour ramps, in GLSL.
 *
 * Near the free stream the speed ramp is essentially white, which is what a
 * real tunnel looks like; it departs from white only where something
 * aerodynamically interesting is happening, so the colour reads as information
 * rather than decoration.
 */
export const RAMP_GLSL = `
uniform int uColorMode;   /* 0 white, 1 speed, 2 vorticity, 3 age */

vec3 speedTint(float s) {
  const vec3 slow = vec3(1.00, 0.46, 0.24);   /* stalled, separated, wake */
  const vec3 mid  = vec3(0.93, 0.95, 0.99);   /* free stream */
  const vec3 fast = vec3(0.36, 0.74, 1.00);   /* accelerated over the shoulder */
  return s < 1.0 ? mix(slow, mid, smoothstep(0.25, 1.00, s))
                 : mix(mid, fast, smoothstep(1.00, 1.40, s));
}

vec3 vortTint(float w) {
  float t = clamp(w * 1.6, 0.0, 1.0);
  vec3 a = vec3(0.16, 0.20, 0.34);
  vec3 b = vec3(0.30, 0.80, 0.86);
  vec3 c = vec3(1.00, 0.86, 0.42);
  return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, (t - 0.5) * 2.0);
}

vec3 ageTint(float a) {
  /* a is 0 at release, 1 at the end of a filament's life. */
  return mix(vec3(0.98, 0.93, 0.72), vec3(0.42, 0.55, 0.95), clamp(a, 0.0, 1.0));
}

/** Cp mapped red (pushing in) through neutral to blue (pulling). */
vec3 pressureTint(float cp) {
  float t = clamp(cp * 0.5 + 0.5, 0.0, 1.0);
  vec3 low  = vec3(0.18, 0.42, 0.95);
  vec3 mid  = vec3(0.72, 0.74, 0.78);
  vec3 high = vec3(0.95, 0.22, 0.16);
  return t < 0.5 ? mix(low, mid, t * 2.0) : mix(mid, high, (t - 0.5) * 2.0);
}

/** The chosen ramp, given everything a sample can know about itself. */
vec3 flowTint(float speed, float vort, float age) {
  if (uColorMode == 1) return speedTint(speed);
  if (uColorMode == 2) return vortTint(vort);
  if (uColorMode == 3) return ageTint(age);
  return vec3(0.93, 0.95, 0.99);
}
`;
