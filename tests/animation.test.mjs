import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {blankAnimation,maxFrames,parseAnimation,seconds} from '../app/animation.ts';
import {parsePuzzle,progressKey,sample} from '../app/puzzle.ts';

const heart={version:1,name:'Heart',size:4,fps:2,trigger:50,background:'#ffffff',palette:{r:'#E0245E'},frames:[['.rr.','rrrr','.rr.','....'],['....','.rr.','....','....']]};

test('a valid animation round-trips, with defaults and normalised colours',()=>{
 const a=parseAnimation(heart);
 assert.equal(a.palette.r,'#e0245e');assert.equal(seconds(a),1);assert.deepEqual(parseAnimation(JSON.parse(JSON.stringify(a))),a);
 const {name,fps,trigger,background,...minimal}=heart;
 assert.deepEqual(parseAnimation(minimal),{...a,name:'Animation',fps:8,trigger:50});
 assert.equal(parseAnimation({...heart,background:'transparent'}).background,'');
 assert.deepEqual(parseAnimation(blankAnimation(16)),blankAnimation(16));
});
test('problems are reported with the frame and row they are in',()=>{
 assert.throws(()=>parseAnimation({...heart,frames:[heart.frames[0],['....','.x..','....','....']]}),/frame 2, row 2 uses "x"/);
 assert.throws(()=>parseAnimation({...heart,frames:[['.rr.','rrrrr','.rr.','....']]}),/frame 1, row 2 .*exactly 4 characters, but has 5/);
 assert.throws(()=>parseAnimation({...heart,frames:[['.rr.','rrrr']]}),/frame 1 must have exactly 4 rows, but has 2/);
 assert.throws(()=>parseAnimation({...heart,size:33}),/"size"/);assert.throws(()=>parseAnimation({...heart,fps:0}),/"fps"/);
 assert.throws(()=>parseAnimation({...heart,trigger:101}),/"trigger"/);assert.throws(()=>parseAnimation({...heart,palette:{rr:'#ffffff'}}),/palette key/);
 assert.throws(()=>parseAnimation({...heart,palette:{r:'red'}}),/#rrggbb/);assert.throws(()=>parseAnimation({...heart,frames:[]}),/at least one frame/);
 assert.equal(maxFrames(32),146);assert.equal(maxFrames(8),300);
 assert.throws(()=>parseAnimation({...blankAnimation(32),frames:Array(147).fill(blankAnimation(32).frames[0])}),/up to 146 frames/);
});
test('the animation is saved with the puzzle and never resets solving progress',()=>{
 const puzzle=parsePuzzle({...sample,id:'custom',animation:heart});
 assert.deepEqual(puzzle.animation,parseAnimation(heart));assert.deepEqual(parsePuzzle(JSON.parse(JSON.stringify(puzzle))),puzzle);
 assert.equal(progressKey(puzzle),progressKey({...sample,id:'custom'}));
 assert.ok(!('animation' in parsePuzzle(sample)));
 assert.throws(()=>parsePuzzle({...sample,animation:{...heart,size:5}}),/frame 1 must have exactly 5 rows/);
});

test('the MCP server validates, renders, saves and attaches animations',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'afterhours-mcp-'));
 await writeFile(join(cwd,'puzzle.json'),JSON.stringify({...sample,id:'custom'}));
 const server=spawn(process.execPath,['--experimental-strip-types',join(import.meta.dirname,'../mcp/animation.mjs')],{cwd,stdio:['pipe','pipe','inherit']});
 const waiting=new Map();let buffer='',id=0;
 server.stdout.on('data',chunk=>{buffer+=chunk;for(let at;(at=buffer.indexOf('\n'))>=0;buffer=buffer.slice(at+1)){const message=JSON.parse(buffer.slice(0,at));waiting.get(message.id)?.(message)}});
 const rpc=(method,params)=>new Promise(resolve=>{waiting.set(++id,resolve);server.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
 const call=async(name,args={})=>(await rpc('tools/call',{name,arguments:args})).result;
 try{
  const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});
  assert.equal(init.result.serverInfo.name,'afterhours-animation');
  server.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const listed=(await rpc('tools/list')).result.tools;
  assert.deepEqual(listed.map(t=>t.name),['get_animation_format','validate_animation','render_animation','save_animation','read_animation','attach_animation']);
  assert.ok(listed.every(t=>t.description&&t.inputSchema.type==='object'));
  assert.match((await call('get_animation_format')).content[0].text,/"palette"/);
  assert.match((await call('validate_animation',{animation:heart})).content[0].text,/Valid.*4 × 4 · 2 frames · 1s · plays at 50% filled/);
  const bad=await call('validate_animation',{animation:{...heart,frames:[['....']]}});
  assert.equal(bad.isError,true);assert.match(bad.content[0].text,/frame 1 must have exactly 4 rows/);
  const rendered=await call('render_animation',{animation:heart});
  assert.equal(rendered.content[1].mimeType,'image/png');
  const image=Buffer.from(rendered.content[1].data,'base64');
  assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(image.readUInt32BE(16),6+2*(4*32+6));
  assert.match((await call('save_animation',{animation:heart,path:'art/heart.json'})).content[0].text,/Saved/);
  assert.deepEqual(JSON.parse(await readFile(join(cwd,'art/heart.json'),'utf8')),parseAnimation(heart));
  assert.equal((await call('save_animation',{animation:heart,path:'art/heart.json'})).isError,true);
  assert.equal((await call('save_animation',{animation:heart,path:'../../escape.json'})).isError,true);
  assert.match((await call('attach_animation',{puzzle_path:'puzzle.json',path:'art/heart.json',trigger:75})).content[0].text,/plays at 75% filled/);
  const attached=parsePuzzle(JSON.parse(await readFile(join(cwd,'puzzle.json'),'utf8')));
  assert.equal(attached.animation.trigger,75);assert.deepEqual(attached.cells,sample.cells);assert.deepEqual(attached.clues,sample.clues);
  assert.equal((await call('attach_animation',{puzzle_path:'puzzle.json',animation:heart})).isError,true);
  assert.match((await call('read_animation',{path:'puzzle.json'})).content[0].text,/"trigger":75/);
  await call('attach_animation',{puzzle_path:'puzzle.json',remove:true});
  assert.ok(!('animation' in JSON.parse(await readFile(join(cwd,'puzzle.json'),'utf8'))));
 }finally{server.kill()}
});
