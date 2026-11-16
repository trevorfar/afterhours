#!/usr/bin/env node
// MCP server (stdio, newline-delimited JSON-RPC, no dependencies) for After Hours pixel-art animations.
// Run: node --experimental-strip-types mcp/animation.mjs      Format: ../ANIMATION.md
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { animationId, decodeAnimation, describe, encodeAnimation, EXTENSION, fileSize, fromBase64, isAnimationFile, parseAnimation, refOf, toBase64, toText } from '../app/animation.ts';
import { parsePuzzle } from '../app/puzzle.ts';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [...new Set([process.cwd(), app])];

/** Resolves a .json or .ahanim path (relative to the start folder) and refuses anything outside the allowed folders. */
function locate(file, base = process.cwd()) {
  if (typeof file !== 'string' || !/\.(json|ahanim)$/.test(file)) throw new Error(`Paths must be .json or ${EXTENSION} files.`);
  const full = path.resolve(base, file);
  if (!roots.some(root => full.startsWith(root + path.sep))) throw new Error(`"${file}" is outside the folders this server may use: ${roots.join(', ')}.`);
  return full;
}
const readBytes = async file => {
  const full = locate(file);
  try { return new Uint8Array(await readFile(full)); } catch (error) { throw new Error(`Could not read ${full}: ${error.message}`); }
};
const readJson = async file => {
  const bytes = await readBytes(file);
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
};
/** A puzzle's animation: the JSON form inline, or a reference with its .ahanim file embedded as base64. */
const fromPuzzle = async (value, file) => {
  if (!value) throw new Error(`The puzzle in ${file} has no animation.`);
  if (value.version !== 2) return parseAnimation(value);
  if (typeof value.data !== 'string') throw new Error(`The puzzle in ${file} refers to an animation file it does not contain. Export the puzzle from the app to include it.`);
  return { ...await decodeAnimation(fromBase64(value.data)), trigger: value.trigger, name: value.name };
};
/** An animation given inline (JSON form), or loaded from an .ahanim file, a JSON animation file or a puzzle file. */
async function load({ animation, path: file }) {
  if (animation !== undefined) return parseAnimation(animation);
  if (file === undefined) throw new Error(`Pass "animation" (the JSON object) or "path" (an ${EXTENSION} or .json file).`);
  const bytes = await readBytes(file);
  if (isAnimationFile(bytes)) return decodeAnimation(bytes);
  const data = await readJson(file);
  return data && typeof data === 'object' && 'cells' in data ? fromPuzzle(data.animation, file) : parseAnimation(data);
}
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'animation';
const summary = a => `“${a.name}”: ${describe(a)} (${a.fps} fps, ${a.palette.length} colors).`;
// Above this many pixels the JSON form is too long to be useful in a conversation.
const TEXT_PIXELS = 400_000;

// --- PNG contact sheet, so a model can see its frames -------------------------------------------------------------
function png(width, height, rgba) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function contactSheet(a, indexes, scale) {
  const gap = 6, cell = a.size * scale, columns = Math.min(indexes.length, 6), rows = Math.ceil(indexes.length / columns);
  const width = gap + columns * (cell + gap), height = gap + rows * (cell + gap), pixels = Buffer.alloc(width * height * 4, 0);
  for (let i = 0; i < width * height; i++) pixels.set([120, 120, 120, 255], i * 4);
  const colors = [undefined, ...a.palette.map(rgb)], back = a.background ? rgb(a.background) : null;
  indexes.forEach((index, n) => {
    const left = gap + (n % columns) * (cell + gap), top = gap + Math.floor(n / columns) * (cell + gap);
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      // Empty pixels of a see-through animation are drawn as a light checkerboard.
      const color = colors[a.frames[index][Math.floor(y / scale) * a.size + Math.floor(x / scale)]] ?? back ?? ((Math.floor(x / scale) + Math.floor(y / scale)) % 2 ? [255, 255, 255] : [225, 225, 225]);
      pixels.set([...color, 255], ((top + y) * width + left + x) * 4);
    }
  });
  return png(width, height, pixels);
}

// --- Tools -----------------------------------------------------------------------------------------------------------
const source = {
  animation: { type: 'object', description: 'The animation in its JSON form (see get_animation_format).' },
  path: { type: 'string', description: 'Instead of "animation": an .ahanim file, a .json animation file, or a puzzle file that has an animation.' },
};
const text = value => ({ content: [{ type: 'text', text: value }] });
const tools = [
  {
    name: 'get_animation_format',
    description: 'Returns the After Hours pixel-art animation formats: the JSON form with its fields, limits, how length maps to frames, and an example, plus the binary .ahanim file. Read this before writing an animation.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => text(await readFile(path.join(app, 'ANIMATION.md'), 'utf8')),
  },
  {
    name: 'validate_animation',
    description: 'Checks an animation. Returns its size, frame count and length in seconds, or the exact field, frame and row that is wrong.',
    inputSchema: { type: 'object', properties: source },
    run: async args => text(`Valid. ${summary(await load(args))}`),
  },
  {
    name: 'render_animation',
    description: 'Renders frames of an animation as one PNG contact sheet (left to right, top to bottom) so you can look at what you drew. Shows up to 24 frames, evenly spaced, unless "frames" lists specific 1-based frame numbers.',
    inputSchema: { type: 'object', properties: { ...source, frames: { type: 'array', items: { type: 'integer', minimum: 1 }, description: '1-based frame numbers to show (up to 24).' } } },
    run: async args => {
      const a = await load(args), count = a.frames.length;
      const chosen = Array.isArray(args.frames) && args.frames.length ? args.frames.slice(0, 24).map(n => n - 1) : Array.from({ length: Math.min(count, 24) }, (_, i) => count <= 24 ? i : Math.round(i * (count - 1) / 23));
      if (chosen.some(i => !Number.isInteger(i) || i < 0 || i >= count)) throw new Error(`"frames" must be whole numbers from 1 to ${count}.`);
      const image = contactSheet(a, chosen, Math.max(1, Math.floor(128 / a.size)));
      return { content: [{ type: 'text', text: `${summary(a)} Frames shown, left to right then top to bottom: ${chosen.map(i => i + 1).join(', ')}.` }, { type: 'image', data: image.toString('base64'), mimeType: 'image/png' }] };
    },
  },
  {
    name: 'save_animation',
    description: 'Validates an animation and writes it to a file that the Animation Studio can import: a compact binary .ahanim file, or the JSON form when the path ends in .json. Defaults to animations/<name>.ahanim in the app folder. Pass "from" instead of "animation" to convert an existing file. Refuses to replace an existing file unless "overwrite" is true.',
    inputSchema: { type: 'object', properties: { animation: source.animation, from: { type: 'string', description: 'Instead of "animation": an existing .ahanim, .json animation or puzzle file to convert.' }, path: { type: 'string', description: 'Where to write the .ahanim or .json file (optional).' }, overwrite: { type: 'boolean' } } },
    run: async args => {
      const a = await load({ animation: args.animation, path: args.from }), full = args.path ? locate(args.path) : locate(`animations/${slug(a.name)}${EXTENSION}`, app);
      const contents = full.endsWith('.json') ? JSON.stringify(toText(a), null, 2) + '\n' : await encodeAnimation(a);
      await mkdir(path.dirname(full), { recursive: true });
      try { await writeFile(full, contents, { flag: args.overwrite ? 'w' : 'wx' }); } catch (error) { throw new Error(error.code === 'EEXIST' ? `${full} already exists. Pass "overwrite": true to replace it, or choose another path.` : error.message); }
      return text(`Saved ${summary(a)}\nFile: ${full} (${fileSize(contents.length)})\nImport it in the app under Animation Studio → Import, or use attach_animation to put it in a puzzle file.`);
    },
  },
  {
    name: 'read_animation',
    description: 'Reads an animation from an .ahanim file, a .json animation file, or a puzzle file that has one. Returns its JSON form, or just a summary when it is too large or colorful for that (use render_animation to look at it).',
    inputSchema: { type: 'object', properties: { path: source.path }, required: ['path'] },
    run: async args => {
      const a = await load({ path: args.path });
      if (a.size * a.size * a.frames.length > TEXT_PIXELS || a.palette.length > 62) return text(`${summary(a)}\nToo large to return as JSON. Use render_animation with "frames" to look at it.`);
      return text(`${summary(a)}\n${JSON.stringify(toText(a))}`);
    },
  },
  {
    name: 'attach_animation',
    description: 'Saves an animation into a crossword puzzle .json file so it plays when a solver fills "trigger" percent of the squares. The rest of the puzzle is untouched. Pass "remove": true to delete the puzzle\'s animation instead. An existing animation is only replaced when "replace" is true.',
    inputSchema: { type: 'object', properties: { puzzle_path: { type: 'string', description: 'The puzzle .json file to change.' }, ...source, trigger: { type: 'integer', minimum: 1, maximum: 100, description: 'Overrides the animation\'s trigger percentage.' }, replace: { type: 'boolean' }, remove: { type: 'boolean' } }, required: ['puzzle_path'] },
    run: async args => {
      const full = locate(args.puzzle_path), puzzle = await readJson(args.puzzle_path);
      parsePuzzle(puzzle);
      if (args.remove) {
        if (!puzzle.animation) return text(`“${puzzle.title}” has no animation; nothing changed.`);
        delete puzzle.animation;
        await writeFile(full, JSON.stringify(puzzle, null, 2) + '\n');
        return text(`Removed the animation from “${puzzle.title}” (${full}).`);
      }
      const loaded = await load(args), trigger = args.trigger ?? loaded.trigger;
      if (!Number.isInteger(trigger) || trigger < 1 || trigger > 100) throw new Error('"trigger" must be a whole number from 1 to 100.');
      const a = { ...loaded, trigger }, bytes = await encodeAnimation(a);
      if (puzzle.animation && !args.replace) throw new Error(`“${puzzle.title}” already has an animation. Pass "replace": true to replace it.`);
      // The puzzle file carries the animation's .ahanim file inside it; the app unpacks it on import.
      puzzle.animation = { ...refOf(a, await animationId(bytes), bytes.length), data: toBase64(bytes) };
      await writeFile(full, JSON.stringify(puzzle, null, 2) + '\n');
      return text(`“${puzzle.title}” (${full}) now carries ${summary(a)}\nImport the puzzle in the app (My puzzles → Import puzzle) to play or publish it.`);
    },
  },
];

// --- JSON-RPC over stdio ---------------------------------------------------------------------------------------------
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
async function handle({ id, method, params }) {
  if (id === undefined) return; // notifications need no reply
  if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'afterhours-animation', version: '1.0.0' }, instructions: 'Create pixel-art animations for After Hours crosswords. Call get_animation_format first, then validate_animation and render_animation while drawing, then save_animation or attach_animation.' } });
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: tools.map(({ run, ...tool }) => tool) } });
  if (method === 'tools/call') {
    const tool = tools.find(t => t.name === params?.name);
    if (!tool) return send({ id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
    try { return send({ id, result: await tool.run(params.arguments ?? {}) }); } catch (error) { return send({ id, result: { isError: true, ...text(error.message) } }); }
  }
  send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}
// Requests are answered in the order they arrive, so a save always lands before the read that follows it.
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
  queue = queue.then(() => handle(message)).catch(error => send({ id: message.id ?? null, error: { code: -32603, message: error.message } }));
});
