/**
 * Pixel-art animation that plays once over the crossword grid. The formats are documented in ANIMATION.md.
 *
 * In memory an animation is typed arrays (one byte per pixel). On disk and on the server it is a compact binary
 * `.ahanim` file: a minute of 256 × 256 animation is tens of megabytes as pixels and typically a few hundred
 * kilobytes as a file. Puzzles carry a small reference to that file rather than the pixels themselves.
 *
 * Shared by the browser (studio + solver), the API and the MCP server, so this file stays dependency-free and uses
 * only erasable TypeScript.
 */
export type Animation = {
  version: 2;
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
  /** palette[i] is the "#rrggbb" color of pixel value i + 1. */
  palette: string[];
  /** frames[f][y * size + x] is 0 for an empty pixel, or a palette index + 1. */
  frames: Uint8Array[];
};

/** The hand-writable JSON form: a palette of single characters and frames drawn as rows of those characters. */
export type TextAnimation = Omit<Animation, 'version' | 'palette' | 'frames'> & { version: 1; palette: Record<string, string>; frames: string[][] };

/** What a puzzle stores: enough to describe and trigger the animation, plus the id of its `.ahanim` file. */
export type AnimationRef = {
  version: 2;
  /** 32 hex characters naming the stored `.ahanim` file. */
  id: string;
  name: string;
  size: number;
  fps: number;
  trigger: number;
  /** Number of frames. */
  frames: number;
  /** Size of the `.ahanim` file. */
  bytes: number;
  /** The file itself as base64. Only present in exported puzzle files, so they are complete on their own. */
  data?: string;
};
/** Puzzles made before `.ahanim` carry the JSON form inline; both keep working. */
export type PuzzleAnimation = AnimationRef | TextAnimation;

export const EMPTY = '.';
export const EXTENSION = '.ahanim';
export const LIMITS = { minSize: 2, maxSize: 256, maxFps: 30, maxFrames: 3600, maxPixels: 120_000_000, maxColors: 255, textColors: 62, maxBytes: 64 * 1024 * 1024 };
/** Palette characters of the JSON form, in order. */
export const KEYS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const HEX = /^#[0-9a-f]{6}$/, ID = /^[0-9a-f]{32}$/, MAGIC = [65, 72, 65, 78], FORMAT = 2, HEADER = 9;

export const maxFrames = (size: number) => Math.min(LIMITS.maxFrames, Math.floor(LIMITS.maxPixels / (size * size)));
export const blankFrame = (size: number) => new Uint8Array(size * size);
export const blankAnimation = (size = 16): Animation => ({ version: 2, name: 'My animation', size, fps: 8, trigger: 50, background: '#ffffff', palette: [], frames: [blankFrame(size)] });
type Shape = { size: number; fps: number; trigger: number; frames: number | ArrayLike<unknown> };
const count = (a: Shape) => typeof a.frames === 'number' ? a.frames : a.frames.length;
export const seconds = (a: Shape) => Math.round((count(a) / a.fps) * 100) / 100;
export const describe = (a: Shape) => `${a.size} × ${a.size} · ${count(a)} ${count(a) === 1 ? 'frame' : 'frames'} · ${seconds(a)}s · plays at ${a.trigger}% filled`;
export const fileSize = (bytes: number) => bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${Math.round(bytes / 102.4) / 10} KB` : `${Math.round(bytes / 104857.6) / 10} MB`;

/** The fields every form shares, validated. */
function settings(a: Record<string, unknown>) {
  const int = (name: string, min: number, max: number, fallback?: number) => {
    const n = a[name] === undefined ? fallback : a[name];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw new Error(`Animation: "${name}" must be a whole number from ${min} to ${max}.`);
    return n;
  };
  const size = int('size', LIMITS.minSize, LIMITS.maxSize), fps = int('fps', 1, LIMITS.maxFps, 8), trigger = int('trigger', 1, 100, 50);
  const name = a.name === undefined ? 'Animation' : a.name;
  if (typeof name !== 'string' || name.length > 60) throw new Error('Animation: "name" must be text up to 60 characters.');
  const background = a.background === undefined ? '#ffffff' : a.background === 'transparent' ? '' : a.background;
  if (typeof background !== 'string' || (background !== '' && !HEX.test(background.toLowerCase()))) throw new Error('Animation: "background" must be "#rrggbb", or "" to show the puzzle through empty pixels.');
  return { name, size, fps, trigger, background: background.toLowerCase() };
}
function frameCount(size: number, frames: number) {
  const limit = maxFrames(size);
  if (!Number.isInteger(frames) || frames < 1) throw new Error('Animation: "frames" must hold at least one frame.');
  if (frames > limit) throw new Error(`Animation: a ${size} × ${size} animation holds up to ${limit} frames; this one has ${frames}.`);
}
const object = (value: unknown, what = 'Animation: expected a JSON object.') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(what);
  return value as Record<string, unknown>;
};

/** Validates the JSON form (untrusted) and returns the animation. Errors say exactly where the problem is. */
export function parseAnimation(value: unknown): Animation {
  const a = object(value);
  if (a.version !== 1) throw new Error('Animation: "version" must be 1.');
  const shared = settings(a), { size } = shared;
  const given = object(a.palette, 'Animation: "palette" must be an object such as {"r": "#ff0000"}.');
  const palette: string[] = [], index: Record<string, number> = {};
  for (const [key, color] of Object.entries(given)) {
    if (key.length !== 1 || !KEYS.includes(key)) throw new Error(`Animation: palette key "${key}" must be one character from 0-9, a-z or A-Z.`);
    if (typeof color !== 'string' || !HEX.test(color.toLowerCase())) throw new Error(`Animation: palette color "${key}" must be "#rrggbb".`);
    index[key] = palette.push(color.toLowerCase());
  }
  if (!Array.isArray(a.frames)) throw new Error('Animation: "frames" must hold at least one frame.');
  frameCount(size, a.frames.length);
  const frames = a.frames.map((frame, f) => {
    if (!Array.isArray(frame) || frame.length !== size) throw new Error(`Animation: frame ${f + 1} must have exactly ${size} rows${Array.isArray(frame) ? `, but has ${frame.length}` : ''}.`);
    const pixels = blankFrame(size);
    frame.forEach((row, y) => {
      if (typeof row !== 'string' || row.length !== size) throw new Error(`Animation: frame ${f + 1}, row ${y + 1} must be a string of exactly ${size} characters${typeof row === 'string' ? `, but has ${row.length}` : ''}.`);
      for (let x = 0; x < size; x++) {
        const c = row[x];
        if (c === EMPTY) continue;
        if (!(c in index)) throw new Error(`Animation: frame ${f + 1}, row ${y + 1} uses "${c}", which is not in the palette. Use "." for an empty pixel.`);
        pixels[y * size + x] = index[c];
      }
    });
    return pixels;
  });
  return { version: 2, ...shared, palette, frames };
}

/** The JSON form of an animation, for animations small enough to read and write by hand. */
export function toText(a: Animation): TextAnimation {
  if (a.palette.length > LIMITS.textColors) throw new Error(`Animation: the JSON form holds up to ${LIMITS.textColors} colors; this one uses ${a.palette.length}. Keep it as an ${EXTENSION} file.`);
  const { size } = a, chars = EMPTY + KEYS;
  return {
    version: 1, name: a.name, size, fps: a.fps, trigger: a.trigger, background: a.background,
    palette: Object.fromEntries(a.palette.map((color, i) => [KEYS[i], color])),
    frames: a.frames.map(frame => Array.from({ length: size }, (_, y) => { let row = ''; for (let x = 0; x < size; x++) row += chars[frame[y * size + x]]; return row; })),
  };
}

// --- The .ahanim file ----------------------------------------------------------------------------------------------
// "AHAN", a format byte, a little-endian uint32 header length, a JSON header (everything except the pixels), then one
// raw-deflate stream holding every frame. Each frame after the first is stored XORed with the frame before it, so
// pixels that don't change become zeros and compress to almost nothing.

type Transform = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
async function pump(stream: Transform, input: Iterable<Uint8Array>) {
  const writer = stream.writable.getWriter(), reader = stream.readable.getReader(), out: Uint8Array[] = [];
  const feeding = (async () => { for (const chunk of input) await writer.write(chunk); await writer.close(); })();
  feeding.catch(() => {});
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(value); total += value.length;
  }
  await feeding;
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of out) { joined.set(chunk, at); at += chunk.length; }
  return joined;
}
const stream = (kind: 'CompressionStream' | 'DecompressionStream') => {
  const make = (globalThis as Record<string, unknown>)[kind] as (new (format: string) => Transform) | undefined;
  if (!make) throw new Error('This browser is too old to read or write animation files. Update it and try again.');
  return new make('deflate-raw');
};

export const isAnimationFile = (bytes: Uint8Array) => bytes.length > HEADER && MAGIC.every((byte, i) => bytes[i] === byte);

/** Packs an animation into the bytes of an `.ahanim` file. */
export async function encodeAnimation(a: Animation): Promise<Uint8Array> {
  const cells = a.size * a.size;
  frameCount(a.size, a.frames.length);
  if (a.palette.length > LIMITS.maxColors) throw new Error(`Animation: holds up to ${LIMITS.maxColors} colors; this one uses ${a.palette.length}.`);
  const header = new TextEncoder().encode(JSON.stringify({ name: a.name, size: a.size, fps: a.fps, trigger: a.trigger, background: a.background, palette: a.palette, frames: a.frames.length }));
  function* deltas() {
    let before: Uint8Array | undefined;
    for (const frame of a.frames) {
      if (frame.length !== cells) throw new Error('Animation: every frame must be size × size pixels.');
      const delta = new Uint8Array(cells);
      if (before) for (let i = 0; i < cells; i++) delta[i] = frame[i] ^ before[i]; else delta.set(frame);
      before = frame;
      yield delta;
    }
  }
  const packed = await pump(stream('CompressionStream'), deltas()), file = new Uint8Array(HEADER + header.length + packed.length);
  file.set(MAGIC); file[4] = FORMAT;
  new DataView(file.buffer).setUint32(5, header.length, true);
  file.set(header, HEADER); file.set(packed, HEADER + header.length);
  return file;
}

/** Reads and validates the bytes of an `.ahanim` file (untrusted). */
export async function decodeAnimation(bytes: Uint8Array): Promise<Animation> {
  const bad = (why: string) => new Error(`That isn’t a readable ${EXTENSION} animation file (${why}).`);
  if (!isAnimationFile(bytes)) throw bad('it doesn’t start with AHAN');
  if (bytes[4] !== FORMAT) throw bad(`format ${bytes[4]} is newer than this app`);
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(5, true);
  if (HEADER + length > bytes.length) throw bad('the header is cut short');
  let header: Record<string, unknown>;
  try { header = object(JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER, HEADER + length)))); } catch { throw bad('the header is damaged'); }
  const shared = settings(header), { size } = shared, cells = size * size, total = header.frames as number;
  frameCount(size, total);
  if (!Array.isArray(header.palette) || header.palette.length > LIMITS.maxColors || header.palette.some(c => typeof c !== 'string' || !HEX.test(c))) throw new Error(`Animation: "palette" must list up to ${LIMITS.maxColors} "#rrggbb" colors.`);
  const palette = header.palette as string[];
  let pixels: Uint8Array;
  try { pixels = await pump(stream('DecompressionStream'), [bytes.subarray(HEADER + length)]); } catch (error) { throw (error as Error).message.startsWith('This browser') ? error : bad('the frames are damaged'); }
  if (pixels.length !== cells * total) throw bad('the frames are the wrong length');
  for (let i = cells; i < pixels.length; i++) pixels[i] ^= pixels[i - cells];
  for (let i = 0; i < pixels.length; i++) if (pixels[i] > palette.length) throw bad('a pixel uses a color that is not in the palette');
  return { version: 2, ...shared, palette, frames: Array.from({ length: total }, (_, f) => pixels.subarray(f * cells, (f + 1) * cells)) };
}

// --- References, as stored in puzzles -------------------------------------------------------------------------------

/** A stable name for a file: its SHA-256 where the browser offers one, otherwise random. */
export async function animationId(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle ? new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource)) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(digest.subarray(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const isAnimationId = (id: unknown): id is string => typeof id === 'string' && ID.test(id);
export const isRef = (a: PuzzleAnimation | undefined): a is AnimationRef => a?.version === 2;
export const refOf = (a: Animation, id: string, bytes: number): AnimationRef => ({ version: 2, id, name: a.name, size: a.size, fps: a.fps, trigger: a.trigger, frames: a.frames.length, bytes });

/** Validates a puzzle's `animation` (untrusted): a reference, or the older inline JSON form. Embedded data is dropped. */
export function parsePuzzleAnimation(value: unknown): PuzzleAnimation {
  const a = object(value);
  if (a.version !== 2) return toText(parseAnimation(a));
  const { name, size, fps, trigger } = settings(a);
  if (!isAnimationId(a.id)) throw new Error('Animation: "id" must be 32 hex characters.');
  frameCount(size, a.frames as number);
  if (typeof a.bytes !== 'number' || !Number.isInteger(a.bytes) || a.bytes < HEADER || a.bytes > LIMITS.maxBytes) throw new Error(`Animation: the file must be smaller than ${fileSize(LIMITS.maxBytes)}.`);
  return { version: 2, id: a.id, name, size, fps, trigger, frames: a.frames as number, bytes: a.bytes };
}

export function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function fromBase64(text: string) {
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
