import { memo, useEffect, useRef, useState } from 'react';
import { blankAnimation, blankFrame, describe, EMPTY, KEYS, LIMITS, maxFrames, parseAnimation, seconds, type Animation } from './animation';
import Player, { paint } from './player';
import type { Puzzle } from './puzzle';

const DRAFT = 'after-hours-animation-draft';
type Tool = 'draw' | 'erase' | 'fill';

export function saveFile(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const Thumb = memo(function Thumb({ size, background, palette, frame }: { size: number; background: string; palette: Record<string, string>; frame: string[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => paint(canvas.current, { size, background, palette }, frame), [size, background, palette, frame]);
  return <canvas ref={canvas} className="animation-canvas" width={size} height={size} />;
});

const clamp = (value: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(value)) || min));
const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/** Every pixel on the straight line between two canvas indexes, so a fast drag leaves no gaps. */
function line(from: number, to: number, size: number) {
  let x = from % size, y = Math.floor(from / size);
  const x1 = to % size, y1 = Math.floor(to / size), dx = Math.abs(x1 - x), dy = -Math.abs(y1 - y), sx = x < x1 ? 1 : -1, sy = y < y1 ? 1 : -1, out = [from];
  for (let error = dx + dy; x !== x1 || y !== y1;) {
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
    out.push(y * size + x);
  }
  return out;
}

export default function Studio({ puzzles, target, onAttach, onCancel }: {
  /** Puzzles an animation can be saved with. */
  puzzles: Puzzle[];
  /** Puzzle to preselect, when the studio was opened from the crossword creator. */
  target?: string;
  onAttach: (id: string, animation: Animation | undefined) => boolean | Promise<boolean>;
  onCancel: () => void;
}) {
  const [anim, setAnim] = useState<Animation>(() => {
    const attached = puzzles.find(p => p.id === target)?.animation;
    if (attached) return structuredClone(attached);
    try { const saved = localStorage.getItem(DRAFT); if (saved) return parseAnimation(JSON.parse(saved)); } catch { /* start fresh */ }
    return blankAnimation();
  });
  const [at, setAt] = useState(0), [tool, setTool] = useState<Tool>('draw'), [color, setColor] = useState('#1f3a5f'), [hex, setHex] = useState('#1f3a5f'), [onion, setOnion] = useState(false);
  const [past, setPast] = useState<Animation[]>([]), [next, setNext] = useState<Animation[]>([]), [playing, setPlaying] = useState(false), [message, setMessage] = useState(''), [storageError, setStorageError] = useState(false);
  const [puzzleId, setPuzzleId] = useState(target ?? puzzles[0]?.id ?? ''), [newSize, setNewSize] = useState(anim.size), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false);
  // Pointer strokes arrive faster than renders, so they build on this copy rather than on a stale closure.
  const live = useRef(anim), stroke = useRef<number | undefined>(undefined), recorded = useRef(false), file = useRef<HTMLInputElement>(null);
  const size = anim.size, frame = anim.frames[Math.min(at, anim.frames.length - 1)], before = onion && at > 0 ? anim.frames[at - 1] : undefined, limit = maxFrames(size);
  const puzzle = puzzles.find(p => p.id === puzzleId), [r, g, b] = channels(color);

  useEffect(() => { try { localStorage.setItem(DRAFT, JSON.stringify(anim)); setStorageError(false); } catch { setStorageError(true); } }, [anim]);
  useEffect(() => {
    const end = () => { stroke.current = undefined; };
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  }, []);

  function set(value: Animation, record = true) {
    if (record) { const previous = live.current; setPast(p => [...p.slice(-59), previous]); setNext([]); }
    live.current = value; setAnim(value); setMessage('');
  }
  function undo(redo = false) {
    const from = redo ? next : past;
    if (!from.length) return;
    const current = live.current, value = from[from.length - 1];
    if (redo) { setNext(from.slice(0, -1)); setPast(p => [...p, current]); } else { setPast(from.slice(0, -1)); setNext(n => [...n, current]); }
    live.current = value; setAnim(value); setAt(i => Math.min(i, value.frames.length - 1)); setNewSize(value.size);
  }
  function pick(value: string) { setColor(value); setHex(value); if (tool === 'erase') setTool('draw'); }
  const withFrames = (frames: string[][], index: number) => { set({ ...live.current, frames }); setAt(index); };

  function plot(indexes: number[], start: boolean) {
    if (playing) return;
    let a = live.current, key = EMPTY;
    if (tool !== 'erase') {
      const known = Object.keys(a.palette).find(k => a.palette[k] === color), free = known ?? [...KEYS].find(k => !(k in a.palette));
      if (!free) { setMessage(`An animation holds up to ${LIMITS.maxColors} colors. Reuse one from the palette.`); return; }
      if (!known) a = { ...a, palette: { ...a.palette, [free]: color } };
      key = free;
    }
    const pixels = a.frames[at].join('').split('');
    let changed = false;
    if (tool === 'fill') {
      if (!start) return;
      const from = pixels[indexes[0]], queue = from === key ? [] : [indexes[0]];
      for (const i of queue) {
        if (pixels[i] !== from) continue;
        pixels[i] = key; changed = true;
        if (i % size) queue.push(i - 1);
        if (i % size < size - 1) queue.push(i + 1);
        if (i >= size) queue.push(i - size);
        if (i < size * (size - 1)) queue.push(i + size);
      }
    } else for (const i of indexes) if (pixels[i] !== key) { pixels[i] = key; changed = true; }
    if (!changed) return;
    const rows = Array.from({ length: size }, (_, y) => pixels.slice(y * size, (y + 1) * size).join(''));
    set({ ...a, frames: a.frames.map((f, i) => i === at ? rows : f) }, !recorded.current);
    recorded.current = true;
  }
  const pixelAt = (el: EventTarget | Element | null) => { const i = (el as HTMLElement | null)?.dataset?.i; return i === undefined ? -1 : Number(i); };
  function pointerDown(e: React.PointerEvent) {
    const i = pixelAt(e.target);
    if (i < 0) return;
    e.preventDefault(); stroke.current = i; recorded.current = false; plot([i], true);
  }
  function pointerMove(e: React.PointerEvent) {
    if (stroke.current === undefined) return;
    const i = pixelAt(document.elementFromPoint(e.clientX, e.clientY));
    if (i < 0 || i === stroke.current) return;
    plot(line(stroke.current, i, size).slice(1), false); stroke.current = i;
  }

  async function attach(animation: Animation | undefined) {
    if (!puzzle) return;
    setBusy(true);
    const saved = await onAttach(puzzle.id, animation && structuredClone(animation));
    setBusy(false);
    setMessage(saved ? animation ? `Saved with “${puzzle.title || 'Untitled crossword'}”. It plays once, when a solver fills ${animation.trigger}% of the squares.` : `Removed from “${puzzle.title || 'Untitled crossword'}”.` : 'That didn’t save. Export JSON to keep a backup.');
  }
  async function importFile(f: File) {
    try {
      if (f.size > 1_000_000) throw new Error('Choose a JSON file smaller than 1 MB.');
      const data = JSON.parse(await f.text()), value = parseAnimation(data && typeof data === 'object' && 'cells' in data ? data.animation ?? (() => { throw new Error('That puzzle has no animation.'); })() : data);
      set(value); setAt(0); setNewSize(value.size); setMessage(`Imported “${value.name}”: ${describe(value)}.`);
    } catch (error) { setMessage(error instanceof SyntaxError ? 'That file isn’t valid JSON.' : (error as Error).message); }
  }

  return <main className="creator studio" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).matches('input[type=text]')) { e.preventDefault(); undo(e.shiftKey); } }}>
    <div className="creator-heading"><div><p className="kicker">THE ANIMATION STUDIO</p><h1>Make it move.</h1><p>A little pixel-art surprise that plays over the grid, once, partway through the solve.</p></div><button className="outline" onClick={onCancel}>Back to puzzles</button></div>
    <div className="creator-topbar"><span className={storageError ? 'error-text' : ''}>{storageError ? 'Browser storage unavailable. Export a backup.' : 'Animation autosaved on this device'}</span><div>
      <button className="outline" onClick={() => file.current?.click()}>Import JSON</button>
      <button className="outline" onClick={() => saveFile(anim.name || 'animation', anim)}>Export JSON</button>
      {puzzles.length > 0 && <select aria-label="Puzzle to save with" value={puzzleId} onChange={e => setPuzzleId(e.target.value)}>{puzzles.map(p => <option key={p.id} value={p.id}>{p.title || 'Untitled crossword'}{p.animation ? ' (has animation)' : ''}</option>)}</select>}
      <button className="primary" disabled={!puzzle || busy} onClick={() => attach(anim)}>Save with puzzle →</button>
    </div></div>
    {!puzzles.length && <p className="fine">Save a crossword to My puzzles first, then come back to attach this animation. Until then it stays here and can be exported.</p>}
    {puzzle?.animation && <p className="fine studio-attached">“{puzzle.title || 'Untitled crossword'}” already has an animation ({describe(puzzle.animation)}). <button onClick={() => { const value = structuredClone(puzzle.animation!); set(value); setAt(0); setNewSize(value.size); }}>Load it here</button> · <button className="delete-link" disabled={busy} onClick={() => attach(undefined)}>Remove it from the puzzle</button></p>}
    {message && <p className="creator-message" role="status">{message}</p>}

    <div className="studio-settings">
      <label className="wide">Name<input type="text" maxLength={60} value={anim.name} onChange={e => set({ ...anim, name: e.target.value })} /></label>
      <label>Frames per second<input type="number" min={1} max={LIMITS.maxFps} value={anim.fps} onChange={e => set({ ...anim, fps: clamp(e.target.value, 1, LIMITS.maxFps) })} /></label>
      <label>Plays at % filled<input type="number" min={1} max={100} value={anim.trigger} onChange={e => set({ ...anim, trigger: clamp(e.target.value, 1, 100) })} /></label>
      <label>Background<span className="inline"><input type="color" aria-label="Background color" disabled={!anim.background} value={anim.background || '#ffffff'} onChange={e => set({ ...anim, background: e.target.value })} /><span className="check"><input type="checkbox" checked={!anim.background} onChange={e => set({ ...anim, background: e.target.checked ? '' : '#ffffff' })} /> Show puzzle through</span></span></label>
      <label>Canvas size (N × N)<span className="inline"><input type="number" aria-label="Canvas size" min={LIMITS.minSize} max={LIMITS.maxSize} value={newSize} onChange={e => setNewSize(clamp(e.target.value, LIMITS.minSize, LIMITS.maxSize))} /><button className="outline" onClick={() => setConfirming(true)}>New blank canvas</button></span></label>
    </div>

    <div className="studio-workspace">
      <section>
        <div className="editor-tools"><div>
          {(['draw', 'erase', 'fill'] as const).map(t => <button key={t} className={tool === t ? 'enabled' : ''} aria-pressed={tool === t} onClick={() => setTool(t)}>{t === 'draw' ? '✎ Draw' : t === 'erase' ? '◻ Erase' : '▧ Fill'}</button>)}
          <button disabled={!past.length} onClick={() => undo()}>↶ Undo</button><button disabled={!next.length} onClick={() => undo(true)}>↷ Redo</button>
        </div><div>
          <button onClick={() => set({ ...anim, frames: anim.frames.map((f, i) => i === at ? blankFrame(size) : f) })}>Clear frame</button>
          <button className={playing ? 'enabled' : ''} onClick={() => setPlaying(!playing)}>{playing ? '■ Stop' : '▶ Preview'}</button>
        </div></div>
        <div className="studio-colors">
          <input type="color" aria-label="Color picker" value={color} onChange={e => pick(e.target.value)} />
          <label>HEX<input type="text" aria-label="Hex color" spellCheck={false} maxLength={7} value={hex} onChange={e => { const value = e.target.value.trim().toLowerCase(), full = value.startsWith('#') ? value : '#' + value; setHex(e.target.value); if (/^#[0-9a-f]{6}$/.test(full)) { setColor(full); if (tool === 'erase') setTool('draw'); } }} onBlur={() => setHex(color)} /></label>
          {(['R', 'G', 'B'] as const).map((name, i) => <label key={name}>{name}<input type="number" aria-label={`${name === 'R' ? 'Red' : name === 'G' ? 'Green' : 'Blue'} (0–255)`} min={0} max={255} value={[r, g, b][i]} onChange={e => { const rgb = [r, g, b]; rgb[i] = clamp(e.target.value, 0, 255); pick('#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('')); }} /></label>)}
        </div>
        <div className="pixel-wrap">
          <div className={`pixel-pad ${anim.background ? '' : 'see-through'}`} role="img" aria-label={`Frame ${at + 1} of ${anim.frames.length}, ${size} by ${size} pixels`} style={{ gridTemplateColumns: `repeat(${size},1fr)`, background: anim.background || undefined }} onPointerDown={pointerDown} onPointerMove={pointerMove}>
            {frame.join('').split('').map((key, i) => { const under = before?.[Math.floor(i / size)][i % size], ghost = key === EMPTY && under && under !== EMPTY ? anim.palette[under] + '55' : undefined; return <div key={i} data-i={i} style={key !== EMPTY || ghost ? { background: anim.palette[key] ?? ghost } : undefined} />; })}
          </div>
          {playing && <div className="animation-stage" style={{ background: anim.background || '#fff' }}><Player animation={anim} onDone={() => setPlaying(false)} /></div>}
        </div>
        <div className="swatches" aria-label="Colors in this animation">{Object.entries(anim.palette).map(([key, value]) => <button key={key} aria-label={`Use ${value}`} title={value} className={value === color ? 'selected' : ''} style={{ background: value }} onClick={() => pick(value)} />)}</div>
        <p className="fine">Click or drag to paint frame {at + 1}. Pick a color with the swatch, a HEX code, or R G B values; colors you use collect in the palette. In the puzzle, the canvas stretches to fill the grid.</p>
      </section>
      <section className="studio-frames">
        <h2>Frames</h2>
        <p>{anim.frames.length} of up to {limit} · {seconds(anim)} seconds at {anim.fps} fps</p>
        <div className="editor-tools"><div>
          <button disabled={anim.frames.length >= limit} onClick={() => withFrames([...anim.frames.slice(0, at + 1), blankFrame(size), ...anim.frames.slice(at + 1)], at + 1)}>+ New frame</button>
          <button disabled={anim.frames.length >= limit} onClick={() => withFrames([...anim.frames.slice(0, at + 1), [...frame], ...anim.frames.slice(at + 1)], at + 1)}>Duplicate</button>
          <button aria-label="Move frame earlier" disabled={at === 0} onClick={() => { const frames = [...anim.frames]; frames.splice(at - 1, 0, ...frames.splice(at, 1)); withFrames(frames, at - 1); }}>←</button>
          <button aria-label="Move frame later" disabled={at === anim.frames.length - 1} onClick={() => { const frames = [...anim.frames]; frames.splice(at + 1, 0, ...frames.splice(at, 1)); withFrames(frames, at + 1); }}>→</button>
          <button className="delete-link" disabled={anim.frames.length === 1} onClick={() => withFrames(anim.frames.filter((_, i) => i !== at), Math.max(0, at - 1))}>Delete frame</button>
        </div><div><label><input type="checkbox" checked={onion} onChange={e => setOnion(e.target.checked)} /> Show previous frame faintly</label></div></div>
        <div className="frame-strip">{anim.frames.map((f, i) => <button key={i} className={`frame ${i === at ? 'selected' : ''}`} aria-label={`Frame ${i + 1}`} aria-current={i === at} onClick={() => setAt(i)}><Thumb size={size} background={anim.background} palette={anim.palette} frame={f} /><span>{i + 1}</span></button>)}</div>
        <div className="validation"><h3>Made by hand, or by an agent.</h3><p>The exported JSON is plain text: a palette of single characters and frames drawn as rows of those characters. Any AI agent can write or edit one; see ANIMATION.md and the bundled MCP server, then use Import JSON here.</p></div>
      </section>
    </div>
    <input hidden type="file" accept=".json,application/json" ref={file} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
    {confirming && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="New blank canvas" onKeyDown={e => { if (e.key === 'Escape') setConfirming(false); }}><h2>Start a blank {newSize} × {newSize} canvas?</h2><p>This replaces every frame. Your name, speed, and trigger stay, and Undo brings the old frames back.</p><button autoFocus className="primary" onClick={() => { set({ ...anim, size: newSize, palette: {}, frames: [blankFrame(newSize)] }); setAt(0); setPlaying(false); setConfirming(false); }}>Start blank canvas</button><button onClick={() => setConfirming(false)}>Cancel</button></section></div>}
  </main>;
}
