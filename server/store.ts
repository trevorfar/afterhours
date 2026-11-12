import { Redis } from '@upstash/redis';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Puzzle } from '../app/puzzle.js';

/**
 * The site's published puzzles, stored as one ordered document so reorders and edits are atomic.
 *
 * - Production (Vercel): Upstash Redis from the KV_REST_API_URL/TOKEN pair the Marketplace integration injects.
 * - Local dev and tests without those env vars: a JSON file under .data/ plus in-memory counters.
 *
 * `puzzles` is null until an editor saves for the first time; the client then shows its bundled defaults.
 */
export type SiteList = { rev: number; puzzles: Puzzle[] | null };

export interface Store {
  read(): Promise<SiteList>;
  /** Replaces the list only if it is still at `rev`; returns the new list, or null on a conflict. */
  write(rev: number, puzzles: Puzzle[]): Promise<SiteList | null>;
  /** Counts a hit against `key` inside a rolling window and returns the running total. */
  hit(key: string, windowSeconds: number): Promise<number>;
}

const KEY = 'afterhours:puzzles', REV_KEY = 'afterhours:puzzles:rev';

// Compare-and-set in one round trip so two editors can't silently overwrite each other.
const WRITE_SCRIPT = `
local rev = tonumber(redis.call('GET', KEYS[2]) or '0')
if rev ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], ARGV[3])
return 1`;

class UpstashStore implements Store {
  constructor(private redis: Redis) {}
  async read() {
    return (await this.redis.get<SiteList>(KEY)) ?? { rev: 0, puzzles: null };
  }
  async write(rev: number, puzzles: Puzzle[]) {
    const next: SiteList = { rev: rev + 1, puzzles };
    const saved = await this.redis.eval(WRITE_SCRIPT, [KEY, REV_KEY], [String(rev), JSON.stringify(next), String(next.rev)]);
    return saved === 1 ? next : null;
  }
  async hit(key: string, windowSeconds: number) {
    const k = `afterhours:${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, windowSeconds);
    return count;
  }
}

class FileStore implements Store {
  private file = path.join(process.env.AFTERHOURS_DATA_DIR || path.join(process.cwd(), '.data'), 'puzzles.json');
  private hits = new Map<string, { count: number; until: number }>();
  async read(): Promise<SiteList> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as SiteList;
    } catch {
      return { rev: 0, puzzles: null };
    }
  }
  async write(rev: number, puzzles: Puzzle[]) {
    if ((await this.read()).rev !== rev) return null;
    const next: SiteList = { rev: rev + 1, puzzles };
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(next));
    return next;
  }
  async hit(key: string, windowSeconds: number) {
    const now = Date.now(), entry = this.hits.get(key);
    const next = entry && entry.until > now ? { ...entry, count: entry.count + 1 } : { count: 1, until: now + windowSeconds * 1000 };
    this.hits.set(key, next);
    return next.count;
  }
}

let store: Store | undefined;
export function getStore(): Store {
  if (store) return store;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  store = url && token ? new UpstashStore(new Redis({ url, token })) : new FileStore();
  return store;
}
