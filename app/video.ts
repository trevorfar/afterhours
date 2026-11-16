import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Animation } from './animation';
import { paint } from './player';

/** Vertical video, as TikTok, Reels and Shorts expect it. */
export const VIDEO = { width: 1080, height: 1920 };
// H.264 High, Main, then Baseline at level 4.2: the first one this browser can encode is used.
const CODECS = ['avc1.64002a', 'avc1.4d002a', 'avc1.42002a'];

/**
 * Renders the animation as a 1080 × 1920 H.264 MP4, encoded in the browser. The square canvas is scaled by a whole
 * number so every pixel stays crisp, centered, with the animation's background filling the rest of the frame.
 */
export async function exportMp4(animation: Animation, onProgress: (done: number) => void = () => {}): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser can’t encode video. Use a current Chrome, Edge or Safari to export an MP4.');
  const { width, height } = VIDEO, { size, fps } = animation;
  // Each frame is repeated to reach at least 24 fps, which every platform accepts; the motion is unchanged.
  const repeat = Math.ceil(24 / fps), rate = fps * repeat, step = 1_000_000 / rate;
  const base = { width, height, bitrate: 8_000_000, framerate: rate };
  let config: VideoEncoderConfig | undefined;
  for (const codec of CODECS) if ((await VideoEncoder.isConfigSupported({ ...base, codec }).catch(() => null))?.supported) { config = { ...base, codec }; break; }
  if (!config) throw new Error('This browser can’t encode H.264 video. Use a current Chrome, Edge or Safari to export an MP4.');

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: rate }, fastStart: 'in-memory' });
  let failure: Error | undefined;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: error => { failure = error; } });
  encoder.configure(config);

  const sprite = document.createElement('canvas'), stage = document.createElement('canvas');
  sprite.width = sprite.height = size; stage.width = width; stage.height = height;
  const ctx = stage.getContext('2d')!, scale = Math.floor(width / size), side = scale * size, left = (width - side) / 2, top = Math.round((height - side) / 2);
  ctx.imageSmoothingEnabled = false;
  try {
    for (let f = 0, n = 0; f < animation.frames.length; f++) {
      paint(sprite, animation, animation.frames[f]);
      ctx.fillStyle = animation.background || '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(sprite, left, top, side, side);
      for (let r = 0; r < repeat; r++, n++) {
        const frame = new VideoFrame(stage, { timestamp: Math.round(n * step), duration: Math.round(step) });
        encoder.encode(frame, { keyFrame: n % (rate * 2) === 0 });
        frame.close();
      }
      if (failure) throw failure;
      // Let the encoder catch up, and the page repaint its progress, rather than queueing the whole video.
      while (encoder.encodeQueueSize > 8) await new Promise(resolve => setTimeout(resolve, 4));
      if (f % 8 === 0) { onProgress(f / animation.frames.length); await new Promise(resolve => setTimeout(resolve)); }
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  onProgress(1);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
