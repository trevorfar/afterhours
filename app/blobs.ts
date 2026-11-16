import { animationId, decodeAnimation, encodeAnimation, fromBase64, isRef, parseAnimation, refOf, toBase64, type Animation, type AnimationRef, type PuzzleAnimation } from './animation';

/**
 * Where animation files live in the browser: IndexedDB, which holds far more than localStorage and stores bytes
 * as bytes. Puzzles only carry a reference, so the puzzle list stays small however long the animations get.
 * Without IndexedDB (some private windows) files are kept in memory for the visit.
 */
const DRAFT = 'draft', PART = 512 * 1024, memory = new Map<string, Uint8Array>();
let opening: Promise<IDBDatabase | null> | undefined;
function database() {
  return opening ??= new Promise(resolve => {
    try {
      const request = indexedDB.open('after-hours', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('animations');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await database();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('animations', mode), request = work(transaction.objectStore('animations'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage is full or unavailable.'));
  });
}
async function get(key: string) {
  const held = memory.get(key);
  if (held) return held;
  const saved = await run<ArrayBuffer | Uint8Array>('readonly', store => store.get(key)).catch(() => undefined);
  return saved ? new Uint8Array(saved) : undefined;
}
/** Returns false when the file could only be kept in memory. */
async function put(key: string, bytes: Uint8Array) {
  if (await database()) try { await run('readwrite', store => store.put(bytes, key)); memory.delete(key); return true; } catch { /* fall through */ }
  memory.set(key, bytes);
  return false;
}

// --- Server side of api/animations.ts: files travel in parts small enough for any host's request limit ---------------
async function download(id: string) {
  const info = await fetch(`/api/animations?id=${id}`);
  if (!info.ok) throw new Error('missing');
  const { parts, bytes } = await info.json() as { parts: number; bytes: number }, file = new Uint8Array(bytes);
  let at = 0;
  for (let part = 0; part < parts; part++) {
    const response = await fetch(`/api/animations?id=${id}&part=${part}`);
    if (!response.ok) throw new Error('missing');
    const chunk = new Uint8Array(await response.arrayBuffer());
    file.set(chunk, at); at += chunk.length;
  }
  return file;
}
/** Makes sure the site has this animation's file. Editor only; a no-op when it is already there. */
export async function uploadAnimation(animation: PuzzleAnimation | undefined) {
  if (!isRef(animation)) return;
  const { id } = animation;
  if ((await fetch(`/api/animations?id=${id}`).catch(() => null))?.ok) return;
  const bytes = await get(id);
  if (!bytes) throw new Error('This device no longer has that animation’s file. Open it in the Animation Studio and save it with the puzzle again.');
  const parts = Math.max(1, Math.ceil(bytes.length / PART));
  for (let part = 0; part < parts; part++) {
    const response = await fetch(`/api/animations?id=${id}&part=${part}&parts=${parts}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes.subarray(part * PART, (part + 1) * PART) as BodyInit });
    if (!response.ok) throw Object.assign(new Error((await response.json().catch(() => ({}))).error || 'Couldn’t upload the animation. Try again.'), { status: response.status });
  }
}

// --- What the app uses -----------------------------------------------------------------------------------------------
const decoded = new Map<string, Promise<Animation>>();
/** The playable animation for a puzzle: from this device, otherwise from the site (then kept on this device). */
export function loadAnimation(animation: PuzzleAnimation): Promise<Animation> {
  if (!isRef(animation)) return Promise.resolve().then(() => parseAnimation(animation));
  const { id, name, trigger } = animation;
  let loading = decoded.get(id);
  if (!loading) {
    loading = (async () => {
      const local = await get(id), bytes = local ?? await download(id).catch(() => { throw new Error('The animation’s file couldn’t be found on this device or on the site.'); });
      const value = await decodeAnimation(bytes);
      if (!local) await put(id, bytes);
      return value;
    })();
    // Keep only the latest one decoded: a long animation is tens of megabytes of pixels.
    decoded.clear(); decoded.set(id, loading);
    loading.catch(() => decoded.delete(id));
  }
  return loading.then(value => ({ ...value, name, trigger }));
}
/** Packs an animation into a file on this device and returns the reference a puzzle stores. */
export async function storeAnimation(animation: Animation): Promise<{ ref: AnimationRef; kept: boolean }> {
  const bytes = await encodeAnimation(animation), id = await animationId(bytes);
  return { ref: refOf(animation, id, bytes.length), kept: await put(id, bytes) };
}
/** A puzzle's animation with its file embedded, so an exported puzzle is complete on its own. */
export async function embedAnimation(animation: PuzzleAnimation): Promise<PuzzleAnimation> {
  if (!isRef(animation)) return animation;
  const bytes = await get(animation.id) ?? await download(animation.id).catch(() => undefined);
  if (!bytes) throw new Error('The animation’s file couldn’t be found, so the puzzle can’t be exported with it.');
  return { ...animation, data: toBase64(bytes) };
}
/** Takes in the file embedded in an imported puzzle's animation (the raw, unparsed value) and returns its id. */
export async function absorbAnimation(raw: unknown) {
  const data = (raw as { data?: unknown } | null)?.data;
  if (typeof data !== 'string') return undefined;
  const bytes = fromBase64(data);
  await decodeAnimation(bytes);
  const id = await animationId(bytes);
  await put(id, bytes);
  return id;
}
export const saveDraft = async (animation: Animation) => put(DRAFT, await encodeAnimation(animation));
export const loadDraft = async () => { const bytes = await get(DRAFT); return bytes ? decodeAnimation(bytes) : undefined; };
/** Deletes stored files that no puzzle refers to any more. */
export async function pruneAnimations(keep: Iterable<string>) {
  const wanted = new Set([DRAFT, ...keep]), keys = await run<IDBValidKey[]>('readonly', store => store.getAllKeys()).catch(() => undefined);
  for (const key of keys ?? []) if (!wanted.has(String(key))) await run('readwrite', store => store.delete(key)).catch(() => {});
}
