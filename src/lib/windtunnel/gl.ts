/**
 * The thin WebGL2 layer the solver and the renderer share.
 *
 * Raw WebGL2, no Three.js. The original plan assumed Three.js for rendering, but the
 * reference solver it points at uses none — and a raymarch through a lattice
 * needs a fragment shader and a fullscreen triangle, not a scene graph. Adding
 * ~600 KB to a feature that must never enter another page's bundle would have
 * been a cost with no matching benefit.
 */

/**
 * Texture units, named once.
 *
 * A sampler bound to the wrong unit is not an error — it reads whatever else is
 * there, and the symptom is a black canvas. Naming them here means the binding
 * and the shader's expectation are stated in one place, across every pass.
 */
export const UNIT = {
  G0: 0,
  G1: 1,
  G2: 2,
  G3: 3,
  G4: 4,
  SOLID: 5,
  FIELD: 6,
  PROFILES: 7,
  POS: 8,
  DYE: 9,
  SCENE: 10,
  DEPTH: 11,
} as const;

function compile(gl: WebGL2RenderingContext, type: number, src: string, name: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`${name} failed to compile: ${log}`);
  }
  return shader;
}

/**
 * A linked program with its uniform locations resolved once.
 *
 * `getUniformLocation` is a string lookup into the driver. Calling it two dozen
 * times per pass, sixty times a second, is measurable — and it is the sort of
 * cost that hides, because nothing about it looks like work.
 */
export class Program {
  readonly handle: WebGLProgram;
  private readonly gl: WebGL2RenderingContext;
  private readonly cache = new Map<string, WebGLUniformLocation | null>();

  constructor(gl: WebGL2RenderingContext, name: string, vsSrc: string, fsSrc: string) {
    this.gl = gl;
    const program = gl.createProgram()!;
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, `${name}.vs`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, `${name}.fs`);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`${name} failed to link: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.handle = program;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.cache.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.handle, name);
      this.cache.set(name, l);
    }
    return l;
  }

  use(): this {
    this.gl.useProgram(this.handle);
    return this;
  }
  i(name: string, v: number): this {
    this.gl.uniform1i(this.loc(name), v);
    return this;
  }
  f(name: string, v: number): this {
    this.gl.uniform1f(this.loc(name), v);
    return this;
  }
  f2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.loc(name), x, y);
    return this;
  }
  f3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this.loc(name), x, y, z);
    return this;
  }
  f4v(name: string, v: Float32Array): this {
    this.gl.uniform4fv(this.loc(name), v);
    return this;
  }
  mat4(name: string, m: Float32Array): this {
    this.gl.uniformMatrix4fv(this.loc(name), false, m);
    return this;
  }
  /** Binds `tex` to `unit` and points the named sampler at it. */
  tex(name: string, unit: number, tex: WebGLTexture): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc(name), unit);
    return this;
  }
  dispose(): void {
    this.gl.deleteProgram(this.handle);
  }
}

export function setFiltering(gl: WebGL2RenderingContext, filter: number) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/**
 * A colour texture.
 *
 * ## Precision, and why some targets are half-float
 *
 * The distributions need `RGBA32F`: they are stored in deviation form and the
 * interesting quantity is a small difference between numbers near the weights.
 * The decoded field, the dye and the baked profiles are **read with linear
 * filtering**, and linear filtering of 32-bit float textures is an optional
 * extension (`OES_texture_float_linear`) that plenty of devices lack.
 * Half-float is filterable in core WebGL2 and carries three decimal digits,
 * which is more than a velocity of order 0.09 lattice units needs — so
 * `RGBA16F` costs nothing and removes the dependency.
 */
export function makeTexture(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  opts: { internal?: number; format?: number; filter?: number; data?: Float32Array | null } = {},
): WebGLTexture {
  const internal = opts.internal ?? gl.RGBA32F;
  const format = opts.format ?? gl.RGBA;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.FLOAT, opts.data ?? null);
  setFiltering(gl, opts.filter ?? gl.NEAREST);
  return tex;
}

/**
 * Builds a framebuffer and *checks it*. An incomplete framebuffer draws nothing
 * and reports nothing; the symptom is a black canvas hours later.
 */
export function makeFramebuffer(
  gl: WebGL2RenderingContext,
  textures: WebGLTexture[],
  depth?: WebGLRenderbuffer,
): WebGLFramebuffer {
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  textures.forEach((tex, i) =>
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0),
  );
  if (depth) {
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(
      `Framebuffer with ${textures.length} colour attachment(s) is incomplete (0x${status.toString(16)}).`,
    );
  }
  return fbo;
}

/** Whether this device can run the tunnel at all (the capability gate). */
let supportProbe: boolean | null = null;

/**
 * The probe context is **released** and the answer cached. Browsers cap how many
 * live WebGL contexts a page may hold — around sixteen — and an un-released
 * probe eventually exhausts that budget, at which point the tunnel reports "your
 * device can't do this" on a device that plainly can.
 */
export function isSupported(): boolean {
  if (supportProbe !== null) return supportProbe;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return (supportProbe = false);
    const hasFloat = gl.getExtension('EXT_color_buffer_float') !== null;
    const enoughTargets = (gl.getParameter(gl.MAX_DRAW_BUFFERS) as number) >= 6;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return (supportProbe = hasFloat && enoughTargets);
  } catch {
    return (supportProbe = false);
  }
}
