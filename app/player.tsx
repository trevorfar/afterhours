import { useEffect, useRef } from 'react';
import type { Animation } from './animation';

/** Draws one frame at one canvas pixel per animation pixel; CSS scales it up with crisp edges. */
export function paint(canvas: HTMLCanvasElement | null, animation: Pick<Animation, 'size' | 'background' | 'palette'>, frame: string[] | undefined) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) return;
  const { size, background, palette } = animation;
  ctx.clearRect(0, 0, size, size);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, size, size); }
  frame?.forEach((row, y) => {
    for (let x = 0; x < size; x++) {
      const color = palette[row[x]];
      if (color) { ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1); }
    }
  });
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
