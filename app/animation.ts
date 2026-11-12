/**
 * Pixel-art animation that plays once over the crossword grid. Documented for people and agents in ANIMATION.md.
 *
 * Shared by the browser (studio + solver), the API (saved with the puzzle) and the MCP server, so this file
 * stays dependency-free and uses only erasable TypeScript.
 */
export type Animation = {
  version: 1;
  /** Shown in the studio and used for file names. */
  name: string;
  /** The canvas is size × size pixels, whatever the crossword's own size. */
  size: number;
  /** Frames per second. Length in seconds = frames.length / fps. */
  fps: number;
  /** Plays when this percentage (1–100) of the white squares is filled. */
  trigger: number;
  /** "#rrggbb" behind the pixels, or "" to let the puzzle show through empty pixels. */
  background: string;
  /** One character (0-9, a-z, A-Z) → "#rrggbb". */
  palette: Record<string, string>;
  /** frames[f][y] is a row of `size` characters: a palette key, or "." for an empty pixel. */
  frames: string[][];
};

export const EMPTY = '.';
export const LIMITS = { minSize: 2, maxSize: 32, maxFps: 30, maxFrames: 300, maxPixels: 150_000, maxColors: 62 };
export const KEYS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const HEX = /^#[0-9a-f]{6}$/;

export const maxFrames = (size: number) => Math.min(LIMITS.maxFrames, Math.floor(LIMITS.maxPixels / (size * size)));
export const blankFrame = (size: number) => Array.from({ length: size }, () => EMPTY.repeat(size));
export const blankAnimation = (size = 16): Animation => ({ version: 1, name: 'My animation', size, fps: 8, trigger: 50, background: '#ffffff', palette: {}, frames: [blankFrame(size)] });
export const seconds = (a: Animation) => Math.round((a.frames.length / a.fps) * 100) / 100;
export const describe = (a: Animation) => `${a.size} × ${a.size} · ${a.frames.length} ${a.frames.length === 1 ? 'frame' : 'frames'} · ${seconds(a)}s · plays at ${a.trigger}% filled`;

/** Validates untrusted JSON and returns a clean copy. Errors say exactly where the problem is. */
export function parseAnimation(value: unknown): Animation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Animation: expected a JSON object.');
  const a = value as Record<string, unknown>;
  const int = (name: string, min: number, max: number, fallback?: number) => {
    const n = a[name] === undefined ? fallback : a[name];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new Error(`Animation: "${name}" must be a whole number from ${min} to ${max}.`);
    return n;
  };
  if (a.version !== 1) throw new Error('Animation: "version" must be 1.');
  const size = int('size', LIMITS.minSize, LIMITS.maxSize), fps = int('fps', 1, LIMITS.maxFps, 8), trigger = int('trigger', 1, 100, 50);
  const name = a.name === undefined ? 'Animation' : a.name;
  if (typeof name !== 'string' || name.length > 60) throw new Error('Animation: "name" must be text up to 60 characters.');
  const background = a.background === undefined ? '#ffffff' : a.background === 'transparent' ? '' : a.background;
  if (typeof background !== 'string' || (background !== '' && !HEX.test(background.toLowerCase()))) throw new Error('Animation: "background" must be "#rrggbb", or "" to show the puzzle through empty pixels.');
  if (!a.palette || typeof a.palette !== 'object' || Array.isArray(a.palette)) throw new Error('Animation: "palette" must be an object such as {"r": "#ff0000"}.');
  const palette: Record<string, string> = {};
  for (const [key, color] of Object.entries(a.palette)) {
    if (key.length !== 1 || !KEYS.includes(key)) throw new Error(`Animation: palette key "${key}" must be one character from 0-9, a-z or A-Z.`);
    if (typeof color !== 'string' || !HEX.test(color.toLowerCase())) throw new Error(`Animation: palette color "${key}" must be "#rrggbb".`);
    palette[key] = color.toLowerCase();
  }
  const limit = maxFrames(size);
  if (!Array.isArray(a.frames) || !a.frames.length) throw new Error('Animation: "frames" must hold at least one frame.');
  if (a.frames.length > limit) throw new Error(`Animation: a ${size} × ${size} animation holds up to ${limit} frames; this one has ${a.frames.length}.`);
  const frames = a.frames.map((frame, f) => {
    if (!Array.isArray(frame) || frame.length !== size) throw new Error(`Animation: frame ${f + 1} must have exactly ${size} rows${Array.isArray(frame) ? `, but has ${frame.length}` : ''}.`);
    return frame.map((row, y) => {
      if (typeof row !== 'string' || row.length !== size) throw new Error(`Animation: frame ${f + 1}, row ${y + 1} must be a string of exactly ${size} characters${typeof row === 'string' ? `, but has ${row.length}` : ''}.`);
      for (const c of row) if (c !== EMPTY && !(c in palette)) throw new Error(`Animation: frame ${f + 1}, row ${y + 1} uses "${c}", which is not in the palette. Use "." for an empty pixel.`);
      return row;
    });
  });
  return { version: 1, name, size, fps, trigger, background: background.toLowerCase(), palette, frames };
}
