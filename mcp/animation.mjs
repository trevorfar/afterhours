#!/usr/bin/env node
// MCP server (stdio, newline-delimited JSON-RPC, no dependencies) for After Hours pixel-art animations.
// Run: node --experimental-strip-types mcp/animation.mjs      Format: ../ANIMATION.md
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { describe, parseAnimation } from '../app/animation.ts';
import { parsePuzzle } from '../app/puzzle.ts';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [...new Set([process.cwd(), app])];

/** Resolves a .json path (relative to the start folder) and refuses anything outside the allowed folders. */
function locate(file, base = process.cwd()) {
  if (typeof file !== 'string' || !file.endsWith('.json')) throw new Error('Paths must be .json files.');
  const full = path.resolve(base, file);
  if (!roots.some(root => full.startsWith(root + path.sep))) throw new Error(`"${file}" is outside the folders this server may use: ${roots.join(', ')}.`);
  return full;
}
const readJson = async file => {
  const full = locate(file);
  try { return JSON.parse(await readFile(full, 'utf8')); } catch (error) { throw new Error(`Could not read ${full}: ${error.message}`); }
};
/** An animation given inline, or loaded from an animation file or a puzzle file. */
async function load({ animation, path: file }) {
  if (animation !== undefined) return parseAnimation(animation);
  if (file === undefined) throw new Error('Pass "animation" (the JSON object) or "path" (a .json file).');
  const data = await readJson(file);
  if (data && typeof data === 'object' && 'cells' in data) {
    if (!data.animation) throw new Error(`The puzzle in ${file} has no animation.`);
    return parseAnimation(data.animation);
  }
  return parseAnimation(data);
}
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'animation';
const summary = a => `“${a.name}”: ${describe(a)} (${a.fps} fps, ${Object.keys(a.palette).length} colors).`;

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
  const colors = Object.fromEntries(Object.entries(a.palette).map(([key, hex]) => [key, rgb(hex)])), back = a.background ? rgb(a.background) : null;
  indexes.forEach((index, n) => {
    const left = gap + (n % columns) * (cell + gap), top = gap + Math.floor(n / columns) * (cell + gap);
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      // Empty pixels of a see-through animation are drawn as a light checkerboard.
      const color = colors[a.frames[index][Math.floor(y / scale)][Math.floor(x / scale)]] ?? back ?? ((Math.floor(x / scale) + Math.floor(y / scale)) % 2 ? [255, 255, 255] : [225, 225, 225]);
      pixels.set([...color, 255], ((top + y) * width + left + x) * 4);
    }
  });
  return png(width, height, pixels);
}

// --- Tools -----------------------------------------------------------------------------------------------------------
const source = {
  animation: { type: 'object', description: 'The animation JSON object (see get_animation_format).' },
  path: { type: 'string', description: 'Instead of "animation": a .json animation file, or a puzzle file that has one.' },
};
const text = value => ({ content: [{ type: 'text', text: value }] });
const tools = [
  {
    name: 'get_animation_format',
    description: 'Returns the After Hours pixel-art animation format: the JSON fields, limits, how length maps to frames, and an example. Read this before writing an animation.',
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
      const image = contactSheet(a, chosen, Math.max(2, Math.floor(128 / a.size)));
      return { content: [{ type: 'text', text: `${summary(a)} Frames shown, left to right then top to bottom: ${chosen.map(i => i + 1).join(', ')}.` }, { type: 'image', data: image.toString('base64'), mimeType: 'image/png' }] };
    },
  },
  {
    name: 'save_animation',
    description: 'Validates an animation and writes it to a .json file that the Animation Studio can import. Defaults to animations/<name>.json in the app folder. Refuses to replace an existing file unless "overwrite" is true.',
    inputSchema: { type: 'object', properties: { animation: source.animation, path: { type: 'string', description: 'Where to write the .json file (optional).' }, overwrite: { type: 'boolean' } }, required: ['animation'] },
    run: async args => {
      const a = parseAnimation(args.animation), full = args.path ? locate(args.path) : locate(`animations/${slug(a.name)}.json`, app);
      await mkdir(path.dirname(full), { recursive: true });
      try { await writeFile(full, JSON.stringify(a, null, 2) + '\n', { flag: args.overwrite ? 'w' : 'wx' }); } catch (error) { throw new Error(error.code === 'EEXIST' ? `${full} already exists. Pass "overwrite": true to replace it, or choose another path.` : error.message); }
      return text(`Saved ${summary(a)}\nFile: ${full}\nImport it in the app under Animation Studio → Import JSON, or use attach_animation to put it in a puzzle file.`);
    },
  },
  {
    name: 'read_animation',
    description: 'Reads an animation from a .json animation file, or from a puzzle file that has one, and returns its JSON.',
    inputSchema: { type: 'object', properties: { path: source.path }, required: ['path'] },
    run: async args => { const a = await load({ path: args.path }); return text(`${summary(a)}\n${JSON.stringify(a)}`); },
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
      const loaded = await load(args), a = args.trigger === undefined ? loaded : parseAnimation({ ...loaded, trigger: args.trigger });
      if (puzzle.animation && !args.replace) throw new Error(`“${puzzle.title}” already has an animation. Pass "replace": true to replace it.`);
      puzzle.animation = a;
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
