import { isAnimationFile, isAnimationId, LIMITS } from '../app/animation.js';
import { isEditor, json } from '../server/auth.js';
import { getStore } from '../server/store.js';

/**
 * Animation files (.ahanim), stored apart from the puzzle list so the list stays small. A file is named by the
 * hash of its contents and never changes, and it travels in parts so no request outgrows a host's body limit.
 */
const PART = 512 * 1024, MAX_PARTS = Math.ceil(LIMITS.maxBytes / PART);
const key = (id: string, part?: number) => `animation:${id}${part === undefined ? '' : `:${part}`}`;
const whole = (value: string | null, max: number) => value !== null && /^\d{1,4}$/.test(value) && Number(value) < max ? Number(value) : undefined;

/** `?id=` describes a file (`{parts, bytes}`); `?id=&part=` returns one part of it. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams, id = query.get('id'), store = getStore();
  if (!isAnimationId(id)) return json({ error: 'Send the animation’s id.' }, 400);
  const info = await store.getBlob(key(id));
  if (!info) return json({ error: 'That animation isn’t on the site.' }, 404);
  const { parts, bytes } = JSON.parse(new TextDecoder().decode(info)) as { parts: number; bytes: number };
  if (!query.has('part')) return json({ parts, bytes });
  const part = whole(query.get('part'), parts), data = part === undefined ? null : await store.getBlob(key(id, part));
  if (!data) return json({ error: 'That part of the animation isn’t on the site.' }, 404);
  return new Response(data as BodyInit, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' } });
}

/** `?id=&part=&parts=` with the bytes of that part as the body; editor only. The file exists once its last part lands. */
export async function PUT(request: Request) {
  if (!isEditor(request)) return json({ error: 'Your editor session ended. Log in again to change the site.' }, 401);
  const query = new URL(request.url).searchParams, id = query.get('id'), parts = whole(query.get('parts'), MAX_PARTS + 1), part = whole(query.get('part'), parts ?? 0);
  if (!isAnimationId(id) || !parts || part === undefined) return json({ error: 'Send id, part and parts.' }, 400);
  const data = new Uint8Array(await request.arrayBuffer());
  if (!data.length || data.length > PART || (part < parts - 1 && data.length !== PART)) return json({ error: `Each part must be ${PART} bytes, except the last.` }, 400);
  if (part === 0 && !isAnimationFile(data)) return json({ error: 'That isn’t an animation file.' }, 400);
  const store = getStore();
  await store.setBlob(key(id, part), data);
  if (part < parts - 1) return json({ stored: part });
  let bytes = 0;
  for (let i = 0; i < parts; i++) {
    const length = (await store.getBlob(key(id, i)))?.length;
    if (!length) return json({ error: `Part ${i} of the animation is missing. Upload it again.` }, 409);
    bytes += length;
  }
  await store.setBlob(key(id), new TextEncoder().encode(JSON.stringify({ parts, bytes })));
  return json({ parts, bytes });
}
