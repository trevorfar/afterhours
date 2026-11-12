import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sample} from '../app/puzzle.ts';

// Exercise the bundled handlers (npm run build) against a throwaway file store.
delete process.env.KV_REST_API_URL;delete process.env.UPSTASH_REDIS_REST_URL;
process.env.AFTERHOURS_DATA_DIR=await mkdtemp(join(tmpdir(),'afterhours-api-'));
process.env.EDITOR_PASSWORD='opensesame';process.env.EDITOR_SECRET='test-secret';
const puzzles=await import('../.server/api/puzzles.mjs'),session=await import('../.server/api/session.mjs');
const request=(method,body,{cookie,ip='1.1.1.1'}={})=>new Request('http://localhost/api/x',{method,headers:{'content-type':'application/json','x-forwarded-for':ip,...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
const login=async(password,ip)=>session.POST(request('POST',{password},{ip}));

test('the site list is empty until an editor saves',async()=>{
 assert.deepEqual(await (await puzzles.GET()).json(),{rev:0,puzzles:null});
});

test('the password is case-insensitive and wrong ones are refused',async()=>{
 assert.equal((await login('nope','2.2.2.2')).status,401);
 for(const password of ['opensesame','OpenSesame','OPENSESAME',' opensesame ']){
  const res=await login(password,'2.2.2.2');
  assert.equal(res.status,200,password);
  assert.match(res.headers.get('set-cookie'),/^ah_editor=.+HttpOnly; Secure; SameSite=Strict/);
 }
});

test('login attempts are rate limited per address',async()=>{
 for(let i=0;i<10;i++)await login('wrong','3.3.3.3');
 assert.equal((await login('opensesame','3.3.3.3')).status,429);
 assert.equal((await login('opensesame','4.4.4.4')).status,200);
});

test('only editors can change the site, and only with finished puzzles',async()=>{
 assert.equal((await puzzles.PUT(request('PUT',{rev:0,puzzles:[sample]}))).status,401);
 assert.equal((await puzzles.PUT(request('PUT',{rev:0,puzzles:[sample]},{cookie:'ah_editor=9999999999999.forged'}))).status,401);
 const cookie=(await login('opensesame','5.5.5.5')).headers.get('set-cookie').split(';')[0];
 assert.equal((await session.GET(request('GET',undefined,{cookie}))).status,200);
 assert.deepEqual(await (await session.GET(request('GET',undefined,{cookie}))).json(),{editor:true});
 const unfinished={...sample,id:'draft',cells:sample.cells.map((c,i)=>i===0?'':c)};
 const bad=await puzzles.PUT(request('PUT',{rev:0,puzzles:[unfinished]},{cookie}));
 assert.equal(bad.status,400);assert.match((await bad.json()).error,/isn’t finished/);
 const saved=await (await puzzles.PUT(request('PUT',{rev:0,puzzles:[sample]},{cookie}))).json();
 assert.equal(saved.rev,1);assert.equal(saved.puzzles[0].id,'sample');
 assert.deepEqual(await (await puzzles.GET()).json(),saved);
 // A second editor still holding rev 0 gets the latest list back instead of overwriting it.
 const stale=await puzzles.PUT(request('PUT',{rev:0,puzzles:[]},{cookie}));
 assert.equal(stale.status,409);assert.equal((await stale.json()).rev,1);
 assert.equal((await (await puzzles.PUT(request('PUT',{rev:1,puzzles:[]},{cookie}))).json()).rev,2);
 assert.match((await session.DELETE()).headers.get('set-cookie'),/^ah_editor=; Path=\/; Max-Age=0/);
});
