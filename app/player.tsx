import { useEffect, useRef } from 'react';
import type { Animation } from './animation';

type Look = Pick<Animation, 'size' | 'background' | 'palette'>;
const rgba = (hex: string, alpha = 255) => ((alpha << 24) | (parseInt(hex.slice(5, 7), 16) << 16) | (parseInt(hex.slice(3, 5), 16) << 8) | parseInt(hex.slice(1, 3), 16)) >>> 0;
// One lookup table per palette: pixel value → packed color, with the faint "previous frame" colors after it.
const tables = new WeakMap<string[], { background: string; table: Uint32Array }>();
function colors({ palette, background }: Look) {
  const cached = tables.get(palette);
  if (cached?.background === background) return cached.table;
  const table = new Uint32Array(512);
  table[0] = background ? rgba(background) : 0;
  palette.forEach((hex, i) => { table[i + 1] = rgba(hex); table[i + 257] = rgba(hex, 85); });
  tables.set(palette, { background, table });
  return table;
}

/**
 * Draws one frame. The canvas is normally one canvas pixel per animation pixel (CSS scales it up with crisp edges);
 * a smaller canvas, such as a thumbnail, samples the frame. `ghost` shows faintly through empty pixels.
 */
export function paint(canvas: HTMLCanvasElement | OffscreenCanvas | null, animation: Look, frame: Uint8Array | undefined, ghost?: Uint8Array) {
  const ctx = canvas?.getContext?.('2d') as CanvasRenderingContext2D | null | undefined;
  if (!canvas || !ctx) return;
  const { size } = animation, { width, height } = canvas, table = colors(animation);
  const image = ctx.createImageData(width, height), out = new Uint32Array(image.data.buffer);
  for (let y = 0, i = 0; y < height; y++) {
    const row = Math.floor(y * size / height) * size;
    for (let x = 0; x < width; x++, i++) {
      const at = row + Math.floor(x * size / width), value = frame ? frame[at] : 0;
      out[i] = value || !ghost || !ghost[at] ? table[value] : table[ghost[at] + 256];
    }
  }
  ctx.putImageData(image, 0, 0);
}

/**
 * Plays the animation once, then calls onDone. Frames follow the wall clock, so a throttled or failing
 * renderer can delay a frame but can never stop the animation from ending.
 */
export default function Player({ animation, onDone }: { animation: Animation; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const start = performance.now(), step = 1000 / animation.fps;
    let shown = -1, timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const index = Math.floor((performance.now() - start) / step);
      if (index >= animation.frames.length) { done.current(); return; }
      if (index !== shown) { shown = index; try { paint(canvas.current, animation, animation.frames[index]); } catch { /* keep the clock running */ } }
      timer = setTimeout(tick, Math.max(1, start + (index + 1) * step - performance.now()));
    };
    tick();
    return () => clearTimeout(timer);
  }, [animation]);
  return <canvas ref={canvas} className="animation-canvas" width={animation.size} height={animation.size} />;
}
