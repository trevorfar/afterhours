import { memo, useEffect, useRef, useState } from 'react';
import { blankAnimation, blankFrame, decodeAnimation, describe, encodeAnimation, EXTENSION, fileSize, fromBase64, isAnimationFile, LIMITS, maxFrames, parseAnimation, seconds, type Animation, type AnimationRef } from './animation';
import { loadAnimation, loadDraft, saveDraft, storeAnimation } from './blobs';
import Player, { paint } from './player';
import type { Puzzle } from './puzzle';
import { exportMp4, VIDEO } from './video';

type Tool = 'draw' | 'erase' | 'fill';
const ZOOMS = [1, 2, 4, 8];

export function saveBlob(name: string, extension: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled') + extension;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const saveFile = (name: string, data: unknown) => saveBlob(name, '.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));

/** Thumbnails are at most 48 pixels square, so a long 256 × 256 animation doesn't hold a full canvas per frame. */
const Thumb = memo(function Thumb({ size, background, palette, frame }: { size: number; background: string; palette: string[]; frame: Uint8Array }) {
  const canvas = useRef<HTMLCanvasElement>(null), side = Math.min(size, 48);
  useEffect(() => paint(canvas.current, { size, background, palette }, frame), [size, background, palette, frame]);
  return <canvas ref={canvas} className="animation-canvas" width={side} height={side} />;
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
  onAttach: (id: string, animation: AnimationRef | undefined) => boolean | Promise<boolean>;
  onCancel: () => void;
}) {
  const [anim, setAnim] = useState<Animation>(() => blankAnimation());
  // The attached animation, or the autosaved draft, is unpacked from browser storage before anything can be drawn.
  const [ready, setReady] = useState(false), [saved, setSaved] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [at, setAt] = useState(0), [tool, setTool] = useState<Tool>('draw'), [color, setColor] = useState('#1f3a5f'), [hex, setHex] = useState('#1f3a5f'), [onion, setOnion] = useState(false), [zoom, setZoom] = useState(1);
  const [past, setPast] = useState<Animation[]>([]), [next, setNext] = useState<Animation[]>([]), [playing, setPlaying] = useState(false), [message, setMessage] = useState('');
  const [puzzleId, setPuzzleId] = useState(target ?? puzzles[0]?.id ?? ''), [newSize, setNewSize] = useState(anim.size), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState('');
  // Pointer strokes arrive faster than renders, so they build on this copy rather than on a stale closure.
  const live = useRef(anim), stroke = useRef<number | undefined>(undefined), recorded = useRef(false), file = useRef<HTMLInputElement>(null), pad = useRef<HTMLCanvasElement>(null), strip = useRef<HTMLDivElement>(null), touched = useRef(false);
  const size = anim.size, index = Math.min(at, anim.frames.length - 1), frame = anim.frames[index], before = onion && index > 0 ? anim.frames[index - 1] : undefined, limit = maxFrames(size);
  const puzzle = puzzles.find(p => p.id === puzzleId), [r, g, b] = channels(color);

  function show(value: Animation) { live.current = value; setAnim(value); setAt(0); setNewSize(value.size); setPlaying(false); }
  useEffect(() => {
    let current = true;
    const attached = puzzles.find(p => p.id === target)?.animation;
    (attached ? loadAnimation(attached) : loadDraft()).then(value => { if (current && value && !touched.current) show(value); }, () => { if (current && attached) setMessage('This puzzle’s animation couldn’t be loaded, so the studio opened blank.'); }).finally(() => { if (current) setReady(true); });
    return () => { current = false; };
  }, []);
  // Autosave, a moment after the last change: packing a long animation is too much work to repeat on every stroke.
  useEffect(() => {
    if (!touched.current) return;
    setSaved('saving');
    const timer = setTimeout(() => saveDraft(anim).then(kept => setSaved(kept ? 'saved' : 'failed'), () => setSaved('failed')), 500);
    return () => clearTimeout(timer);
  }, [anim]);
  useEffect(() => {
    const end = () => { stroke.current = undefined; };
    window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    return () => { window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); };
  }, []);
  useEffect(() => paint(pad.current, anim, frame, before), [size, anim.background, anim.palette, frame, before]);
  useEffect(() => { (strip.current?.children[index] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' }); }, [index]);

  function set(value: Animation, record = true) {
    if (record) { const previous = live.current; setPast(p => [...p.slice(-59), previous]); setNext([]); }
    touched.current = true; live.current = value; setAnim(value); setMessage('');
  }
  function undo(redo = false) {
    const from = redo ? next : past;
    if (!from.length) return;
    const current = live.current, value = from[from.length - 1];
    if (redo) { setNext(from.slice(0, -1)); setPast(p => [...p, current]); } else { setPast(from.slice(0, -1)); setNext(n => [...n, current]); }
    touched.current = true; live.current = value; setAnim(value); setAt(i => Math.min(i, value.frames.length - 1)); setNewSize(value.size);
  }
  function pick(value: string) { setColor(value); setHex(value); if (tool === 'erase') setTool('draw'); }
  const withFrames = (frames: Uint8Array[], to: number) => { set({ ...live.current, frames }); setAt(to); };

  function plot(indexes: number[], start: boolean) {
    if (playing || !ready) return;
    let a = live.current, value = 0;
    if (tool !== 'erase') {
      value = a.palette.indexOf(color) + 1;
      if (!value) {
        if (a.palette.length >= LIMITS.maxColors) { setMessage(`An animation holds up to ${LIMITS.maxColors} colors. Reuse one from the palette.`); return; }
        a = { ...a, palette: [...a.palette, color] };
        value = a.palette.length;
      }
    }
    const pixels = a.frames[index].slice();
    let changed = false;
    if (tool === 'fill') {
      if (!start) return;
      const from = pixels[indexes[0]], queue = from === value ? [] : [indexes[0]];
      while (queue.length) {
        const i = queue.pop()!;
        if (pixels[i] !== from) continue;
        pixels[i] = value; changed = true;
        if (i % size) queue.push(i - 1);
        if (i % size < size - 1) queue.push(i + 1);
        if (i >= size) queue.push(i - size);
        if (i < size * (size - 1)) queue.push(i + size);
      }
    } else for (const i of indexes) if (pixels[i] !== value) { pixels[i] = value; changed = true; }
    if (!changed) return;
    set({ ...a, frames: a.frames.map((f, i) => i === index ? pixels : f) }, !recorded.current);
    recorded.current = true;
  }
  /** The canvas pixel under the pointer, wherever the pad is scrolled or zoomed to. */
  function pixelAt(e: React.PointerEvent) {
    const box = pad.current!.getBoundingClientRect(), to = (offset: number, length: number) => Math.max(0, Math.min(size - 1, Math.floor(offset / (length || 1) * size)));
    return to(e.clientY - box.top, box.height) * size + to(e.clientX - box.left, box.width);
  }
  function pointerDown(e: React.PointerEvent) {
    if (e.button > 0) return;
    e.preventDefault();
    try { pad.current?.setPointerCapture(e.pointerId); } catch { /* the stroke still works without capture */ }
    const i = pixelAt(e);
    stroke.current = i; recorded.current = false; plot([i], true);
  }
  function pointerMove(e: React.PointerEvent) {
    if (stroke.current === undefined) return;
    const i = pixelAt(e);
    if (i === stroke.current) return;
    plot(line(stroke.current, i, size).slice(1), false); stroke.current = i;
  }

  const working = async (label: string, work: () => Promise<string>) => {
    setBusy(label);
    try { setMessage(await work()); } catch (error) { setMessage((error as Error).message); } finally { setBusy(''); }
  };
  const attach = (remove = false) => puzzle && working(remove ? 'Removing…' : 'Saving…', async () => {
    const title = puzzle.title || 'Untitled crossword';
    if (remove) return await onAttach(puzzle.id, undefined) ? `Removed from “${title}”.` : 'That didn’t save. Try again.';
    const { ref, kept } = await storeAnimation(anim);
    if (!await onAttach(puzzle.id, ref)) return 'That didn’t save. Export the animation to keep a backup.';
    return `Saved with “${title}” (${fileSize(ref.bytes)}). It plays once, when a solver fills ${ref.trigger}% of the squares.${kept ? '' : ' This browser couldn’t store the file, so export the animation to keep it after you leave.'}`;
  });
  const exportFile = () => working('Exporting…', async () => {
    const bytes = await encodeAnimation(anim);
    saveBlob(anim.name || 'animation', EXTENSION, new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    return `Exported “${anim.name}” (${fileSize(bytes.length)}).`;
  });
  const exportVideo = () => working('Rendering video… 0%', async () => {
    setPlaying(false);
    const video = await exportMp4(anim, done => setBusy(`Rendering video… ${Math.round(done * 100)}%`));
    saveBlob(anim.name || 'animation', '.mp4', video);
    return `Exported a ${VIDEO.width} × ${VIDEO.height} MP4 (${fileSize(video.size)}), ready for TikTok or Reels.`;
  });
  const importFile = (f: File) => working('Importing…', async () => {
    try {
      if (f.size > LIMITS.maxBytes * 2) throw new Error(`Choose a file smaller than ${fileSize(LIMITS.maxBytes * 2)}.`);
      const bytes = new Uint8Array(await f.arrayBuffer());
      let value: Animation;
      if (isAnimationFile(bytes)) value = await decodeAnimation(bytes);
      else {
        const data = JSON.parse(new TextDecoder().decode(bytes)), inner = data && typeof data === 'object' && 'cells' in data ? data.animation ?? (() => { throw new Error('That puzzle has no animation.'); })() : data;
        value = inner?.version === 2 && typeof inner.data === 'string' ? await decodeAnimation(fromBase64(inner.data)) : parseAnimation(inner);
      }
      set(value); show(value);
      return `Imported “${value.name}”: ${describe(value)}.`;
    } catch (error) { throw error instanceof SyntaxError ? new Error(`That file isn’t an ${EXTENSION} animation or valid JSON.`) : error; }
  });
  const loadAttached = (attached: NonNullable<Puzzle['animation']>) => working('Loading…', async () => { const value = await loadAnimation(attached); set(value); show(value); return `Loaded “${value.name}”: ${describe(value)}.`; });

  return <main className="creator studio" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).matches('input[type=text]')) { e.preventDefault(); undo(e.shiftKey); } }}>
    <div className="creator-heading"><div><p className="kicker">THE ANIMATION STUDIO</p><h1>Make it move.</h1><p>A little pixel-art surprise that plays over the grid, once, partway through the solve.</p></div><button className="outline" onClick={onCancel}>Back to puzzles</button></div>
    <div className="creator-topbar"><span className={saved === 'failed' ? 'error-text' : ''}>{busy || (saved === 'failed' ? 'Browser storage unavailable. Export a backup.' : saved === 'saving' ? 'Saving…' : 'Animation autosaved on this device')}</span><div>
      <button className="outline" disabled={!!busy} onClick={() => file.current?.click()}>Import</button>
      <button className="outline" disabled={!!busy} onClick={exportFile}>Export</button>
      <button className="outline" disabled={!!busy} onClick={exportVideo}>Export MP4</button>
      {puzzles.length > 0 && <select aria-label="Puzzle to save with" value={puzzleId} onChange={e => setPuzzleId(e.target.value)}>{puzzles.map(p => <option key={p.id} value={p.id}>{p.title || 'Untitled crossword'}{p.animation ? ' (has animation)' : ''}</option>)}</select>}
      <button className="primary" disabled={!puzzle || !!busy || !ready} onClick={() => attach()}>Save with puzzle →</button>
    </div></div>
    {!puzzles.length && <p className="fine">Save a crossword to My puzzles first, then come back to attach this animation. Until then it stays here and can be exported.</p>}
    {puzzle?.animation && <p className="fine studio-attached">“{puzzle.title || 'Untitled crossword'}” already has an animation ({describe(puzzle.animation)}). <button disabled={!!busy} onClick={() => loadAttached(puzzle.animation!)}>Load it here</button> · <button className="delete-link" disabled={!!busy} onClick={() => attach(true)}>Remove it from the puzzle</button></p>}
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
          <label className="zoom">Zoom<select aria-label="Zoom" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{ZOOMS.map(z => <option key={z} value={z}>{z}×</option>)}</select></label>
          <button onClick={() => set({ ...anim, frames: anim.frames.map((f, i) => i === index ? blankFrame(size) : f) })}>Clear frame</button>
          <button className={playing ? 'enabled' : ''} onClick={() => setPlaying(!playing)}>{playing ? '■ Stop' : '▶ Preview'}</button>
        </div></div>
        <div className="studio-colors">
          <input type="color" aria-label="Color picker" value={color} onChange={e => pick(e.target.value)} />
          <label>HEX<input type="text" aria-label="Hex color" spellCheck={false} maxLength={7} value={hex} onChange={e => { const value = e.target.value.trim().toLowerCase(), full = value.startsWith('#') ? value : '#' + value; setHex(e.target.value); if (/^#[0-9a-f]{6}$/.test(full)) { setColor(full); if (tool === 'erase') setTool('draw'); } }} onBlur={() => setHex(color)} /></label>
          {(['R', 'G', 'B'] as const).map((name, i) => <label key={name}>{name}<input type="number" aria-label={`${name === 'R' ? 'Red' : name === 'G' ? 'Green' : 'Blue'} (0–255)`} min={0} max={255} value={[r, g, b][i]} onChange={e => { const rgb = [r, g, b]; rgb[i] = clamp(e.target.value, 0, 255); pick('#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('')); }} /></label>)}
        </div>
        <div className="pixel-wrap">
          <div className="pixel-scroll">
            <div className={`pixel-pad ${anim.background ? '' : 'see-through'}`} style={{ width: `${zoom * 100}%` }}>
              <canvas ref={pad} className="animation-canvas" role="img" aria-label={`Frame ${index + 1} of ${anim.frames.length}, ${size} by ${size} pixels`} width={size} height={size} onPointerDown={pointerDown} onPointerMove={pointerMove} />
              {size * 4 <= 140 * zoom && <div className="pixel-lines" style={{ backgroundSize: `${100 / size}% ${100 / size}%` }} />}
            </div>
          </div>
          {playing && <div className="animation-stage" style={{ background: anim.background || '#fff' }}><Player animation={anim} onDone={() => setPlaying(false)} /></div>}
          {!ready && <div className="animation-stage studio-loading">Loading your animation…</div>}
        </div>
        <div className="swatches" aria-label="Colors in this animation">{anim.palette.map((value, i) => <button key={i} aria-label={`Use ${value}`} title={value} className={value === color ? 'selected' : ''} style={{ background: value }} onClick={() => pick(value)} />)}</div>
        <p className="fine">Click or drag to paint frame {index + 1}. Pick a color with the swatch, a HEX code, or R G B values; colors you use collect in the palette. In the puzzle, the canvas stretches to fill the grid.</p>
      </section>
      <section className="studio-frames">
        <h2>Frames</h2>
        <p>{anim.frames.length} of up to {limit} · {seconds(anim)} seconds at {anim.fps} fps</p>
        <div className="editor-tools"><div>
          <button disabled={anim.frames.length >= limit} onClick={() => withFrames([...anim.frames.slice(0, index + 1), blankFrame(size), ...anim.frames.slice(index + 1)], index + 1)}>+ New frame</button>
          <button disabled={anim.frames.length >= limit} onClick={() => withFrames([...anim.frames.slice(0, index + 1), frame, ...anim.frames.slice(index + 1)], index + 1)}>Duplicate</button>
          <button aria-label="Move frame earlier" disabled={index === 0} onClick={() => { const frames = [...anim.frames]; frames.splice(index - 1, 0, ...frames.splice(index, 1)); withFrames(frames, index - 1); }}>←</button>
          <button aria-label="Move frame later" disabled={index === anim.frames.length - 1} onClick={() => { const frames = [...anim.frames]; frames.splice(index + 1, 0, ...frames.splice(index, 1)); withFrames(frames, index + 1); }}>→</button>
          <button className="delete-link" disabled={anim.frames.length === 1} onClick={() => withFrames(anim.frames.filter((_, i) => i !== index), Math.max(0, index - 1))}>Delete frame</button>
        </div><div><label><input type="checkbox" checked={onion} onChange={e => setOnion(e.target.checked)} /> Show previous frame faintly</label></div></div>
        {anim.frames.length > 1 && <label className="scrubber">Frame {index + 1}<input type="range" aria-label="Current frame" min={1} max={anim.frames.length} value={index + 1} onChange={e => setAt(Number(e.target.value) - 1)} /></label>}
        <div className="frame-strip" ref={strip}>{anim.frames.map((f, i) => <button key={i} className={`frame ${i === index ? 'selected' : ''}`} aria-label={`Frame ${i + 1}`} aria-current={i === index} onClick={() => setAt(i)}><Thumb size={size} background={anim.background} palette={anim.palette} frame={f} /><span>{i + 1}</span></button>)}</div>
      </section>
    </div>
    <input hidden type="file" accept={`${EXTENSION},.json,application/json`} ref={file} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f); }} />
    {confirming && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="New blank canvas" onKeyDown={e => { if (e.key === 'Escape') setConfirming(false); }}><h2>Start a blank {newSize} × {newSize} canvas?</h2><p>This replaces every frame. Your name, speed, and trigger stay, and Undo brings the old frames back.</p><button autoFocus className="primary" onClick={() => { set({ ...anim, size: newSize, palette: [], frames: [blankFrame(newSize)] }); setAt(0); setPlaying(false); setConfirming(false); }}>Start blank canvas</button><button onClick={() => setConfirming(false)}>Cancel</button></section></div>}
  </main>;
}
