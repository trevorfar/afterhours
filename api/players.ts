import { Redis } from '@upstash/redis';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { json } from '../server/auth.js';
import { getStore } from '../server/store.js';
import first from '../crossword1.json' with { type: 'json' };
import { sample } from '../app/puzzle.js';
import { sample12 } from '../app/examples.js';

const key = 'afterhours:player-records';
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({url, token, automaticDeserialization:false}) : undefined;
const dir = process.env.AFTERHOURS_DATA_DIR || '.data';
const file = path.join(dir, 'players.json');

function localRecords(): string[] {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}

export async function GET() {
  const records = redis ? await redis.smembers<string[]>(key) : localRecords();
  const scores: Record<string,string[]> = Object.create(null);
  for (const record of records) {
    const [name,id] = JSON.parse(record) as [string,string|null];
    const completed = scores[name] ??= [];
    if (id !== null) completed.push(id);
  }
  return json(scores);
}

export async function POST(request:Request) {
  const body = await request.json().catch(()=>null);
  const name = typeof body?.name === 'string' ? body.name.trim().toLowerCase() : '';
  if (!/^[a-z0-9_ ]{1,30}$/.test(name)) return json({error:'Choose a player name.'},400);
  const id = body.id ?? null;
  if (id !== null) {
    const puzzles = (await getStore().read()).puzzles ?? [first,sample,sample12];
    if (typeof body.done !== 'boolean' || !puzzles.some(p=>p.id===id)) return json({error:'Choose a published crossword.'},400);
  }
  const record = JSON.stringify([name,id]);
  const remove = id !== null && !body.done;
  if (redis) {
    if (remove) await redis.srem(key,record);
    else await redis.sadd(key,record);
  } else {
    const records = new Set(localRecords());
    if (remove) records.delete(record);
    else records.add(record);
    mkdirSync(dir,{recursive:true});
    writeFileSync(file+'.tmp',JSON.stringify([...records]));
    renameSync(file+'.tmp',file);
  }
  return json({ok:true});
}
