import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {animationId,blankAnimation,blankFrame,decodeAnimation,describe,encodeAnimation,fromBase64,isAnimationFile,maxFrames,parseAnimation,refOf,seconds,toBase64,toText} from '../app/animation.ts';
import {parsePuzzle,progressKey,sample} from '../app/puzzle.ts';

const heart={version:1,name:'Heart',size:4,fps:2,trigger:50,background:'#ffffff',palette:{r:'#E0245E'},frames:[['.rr.','rrrr','.rr.','....'],['....','.rr.','....','....']]};

test('the JSON form parses to pixels and back, with defaults and normalised colours',()=>{
 const a=parseAnimation(heart);
 assert.deepEqual(a.palette,['#e0245e']);assert.equal(seconds(a),1);assert.deepEqual([...a.frames[0]],[0,1,1,0,1,1,1,1,0,1,1,0,0,0,0,0]);
 assert.deepEqual(parseAnimation(toText(a)),a);assert.deepEqual(toText(a).frames,[['.00.','0000','.00.','....'],['....','.00.','....','....']]);
 const {name,fps,trigger,background,...minimal}=heart;
 assert.deepEqual(parseAnimation(minimal),{...a,name:'Animation',fps:8,trigger:50});
 assert.equal(parseAnimation({...heart,background:'transparent'}).background,'');
 assert.equal(describe(a),'4 × 4 · 2 frames · 1s · plays at 50% filled');
});
test('problems are reported with the frame and row they are in',()=>{
 assert.throws(()=>parseAnimation({...heart,frames:[heart.frames[0],['....','.x..','....','....']]}),/frame 2, row 2 uses "x"/);
 assert.throws(()=>parseAnimation({...heart,frames:[['.rr.','rrrrr','.rr.','....']]}),/frame 1, row 2 .*exactly 4 characters, but has 5/);
 assert.throws(()=>parseAnimation({...heart,frames:[['.rr.','rrrr']]}),/frame 1 must have exactly 4 rows, but has 2/);
 assert.throws(()=>parseAnimation({...heart,size:257}),/"size"/);assert.throws(()=>parseAnimation({...heart,fps:0}),/"fps"/);
 assert.throws(()=>parseAnimation({...heart,trigger:101}),/"trigger"/);assert.throws(()=>parseAnimation({...heart,palette:{rr:'#ffffff'}}),/palette key/);
 assert.throws(()=>parseAnimation({...heart,palette:{r:'red'}}),/#rrggbb/);assert.throws(()=>parseAnimation({...heart,frames:[]}),/at least one frame/);
 assert.equal(maxFrames(8),3600);assert.equal(maxFrames(64),3600);assert.equal(maxFrames(256),1831);
 const row='.'.repeat(8),blank=Array(8).fill(row);
 assert.equal(parseAnimation({...heart,size:8,frames:Array(3600).fill(blank)}).frames.length,3600);
 assert.throws(()=>parseAnimation({...heart,size:8,frames:Array(3601).fill(blank)}),/up to 3600 frames/);
});
test('an .ahanim file round-trips, stays small for long animations, and rejects damage',async()=>{
 const a=parseAnimation(heart),file=await encodeAnimation(a);
 assert.ok(isAnimationFile(file));assert.deepEqual(await decodeAnimation(file),a);
 assert.match(await animationId(file),/^[0-9a-f]{32}$/);assert.equal(await animationId(file),await animationId(await encodeAnimation(parseAnimation(heart))));
 // A minute of 256 × 256 at 12 fps: a square that moves one pixel per frame over a static scene, in 200 colours.
 const size=256,palette=Array.from({length:200},(_,i)=>'#'+(i*65793).toString(16).padStart(6,'0')),scene=new Uint8Array(size*size).map((_,i)=>1+(i>>8)%200);
 const long={...blankAnimation(size),fps:12,palette,frames:Array.from({length:720},(_,f)=>{const frame=scene.slice();for(let y=100;y<140;y++)frame.fill(7,y*size+f%200,y*size+f%200+40);return frame})};
 const packed=await encodeAnimation(long);
 assert.ok(packed.length<400_000,`47 million pixels packed into ${packed.length} bytes`);
 const back=await decodeAnimation(packed);
 assert.equal(back.frames.length,720);assert.deepEqual(back.frames[719],long.frames[719]);assert.deepEqual(back.palette,palette);assert.equal(seconds(back),60);
 await assert.rejects(decodeAnimation(file.subarray(0,file.length-3)),/isn’t a readable/);
 await assert.rejects(decodeAnimation(new TextEncoder().encode('{"version":1}')),/doesn’t start with AHAN/);
 const tooMany=await encodeAnimation({...a,palette:[],frames:[blankFrame(4)]});
 await assert.rejects(decodeAnimation(await encodeAnimation({...a,palette:['#000000','#ffffff'],frames:[blankFrame(4).fill(2)]}).then(bytes=>{const text=new TextDecoder('latin1').decode(bytes).replace('"#000000","#ffffff"','"#000000"');return Uint8Array.from(text,c=>c.charCodeAt(0)).map((v,i)=>i===5?v-10:v)})),/not in the palette/);
 assert.equal((await decodeAnimation(tooMany)).palette.length,0);
 assert.deepEqual(fromBase64(toBase64(file)),file);
});
test('a puzzle stores a reference to its animation and never resets solving progress',async()=>{
 const a=parseAnimation(heart),file=await encodeAnimation(a),ref=refOf(a,await animationId(file),file.length);
 assert.deepEqual(ref,{version:2,id:ref.id,name:'Heart',size:4,fps:2,trigger:50,frames:2,bytes:file.length});assert.equal(describe(ref),describe(a));
 const puzzle=parsePuzzle({...sample,id:'custom',animation:{...ref,data:toBase64(file)}});
 assert.deepEqual(puzzle.animation,ref,'the embedded file of an exported puzzle is not kept in the puzzle');assert.deepEqual(parsePuzzle(JSON.parse(JSON.stringify(puzzle))),puzzle);
 assert.equal(progressKey(puzzle),progressKey({...sample,id:'custom'}));
 assert.ok(!('animation' in parsePuzzle(sample)));
 assert.throws(()=>parsePuzzle({...sample,animation:{...ref,id:'nope'}}),/"id"/);assert.throws(()=>parsePuzzle({...sample,animation:{...ref,frames:0}}),/at least one frame/);
 // Puzzles saved before .ahanim carry the JSON form inline, and still load.
 const older=parsePuzzle({...sample,id:'custom',animation:heart});
 assert.deepEqual(older.animation,toText(a));assert.deepEqual(parsePuzzle(JSON.parse(JSON.stringify(older))),older);
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
  assert.deepEqual(JSON.parse(await readFile(join(cwd,'art/heart.json'),'utf8')),toText(parseAnimation(heart)));
  assert.match((await call('save_animation',{from:'art/heart.json',path:'art/heart.ahanim'})).content[0].text,/Saved/);
  assert.deepEqual(await decodeAnimation(new Uint8Array(await readFile(join(cwd,'art/heart.ahanim')))),parseAnimation(heart));
  assert.match((await call('validate_animation',{path:'art/heart.ahanim'})).content[0].text,/Valid.*4 × 4 · 2 frames/);
  assert.equal((await call('save_animation',{animation:heart,path:'art/heart.json'})).isError,true);
  assert.equal((await call('save_animation',{animation:heart,path:'../../escape.json'})).isError,true);
  assert.match((await call('attach_animation',{puzzle_path:'puzzle.json',path:'art/heart.ahanim',trigger:75})).content[0].text,/plays at 75% filled/);
  const written=JSON.parse(await readFile(join(cwd,'puzzle.json'),'utf8')),attached=parsePuzzle(written);
  assert.equal(attached.animation.trigger,75);assert.equal(attached.animation.frames,2);assert.deepEqual((await decodeAnimation(fromBase64(written.animation.data))).frames,parseAnimation(heart).frames);assert.deepEqual(attached.cells,sample.cells);assert.deepEqual(attached.clues,sample.clues);
  assert.equal((await call('attach_animation',{puzzle_path:'puzzle.json',animation:heart})).isError,true);
  assert.match((await call('read_animation',{path:'puzzle.json'})).content[0].text,/"trigger":75/);
  await call('attach_animation',{puzzle_path:'puzzle.json',remove:true});
  assert.ok(!('animation' in JSON.parse(await readFile(join(cwd,'puzzle.json'),'utf8'))));
 }finally{server.kill()}
});
