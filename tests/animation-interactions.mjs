import {Window} from 'happy-dom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {progressKey,sample} from '../app/puzzle.ts';
import {decodeAnimation} from '../app/animation.ts';
const window=new Window({url:'http://localhost:3000',settings:{enableJavaScriptEvaluation:true}});
window.structuredClone=globalThis.structuredClone;
for(const name of ['CompressionStream','DecompressionStream'])window[name]=globalThis[name];
window.fetch=()=>Promise.reject(new Error('offline'));
// A saved puzzle whose 0.3-second animation plays once 10% of the squares (5 of 41) are filled.
const animation={version:1,name:'Flash',size:4,fps:10,trigger:10,background:'#ffffff',palette:{b:'#326da9'},frames:[['b...','....','....','....'],['bb..','bb..','....','....'],['bbbb','bbbb','bbbb','bbbb']]};
const puzzle={...sample,id:'animated',title:'Animated one',animation},saveKey=progressKey(puzzle);
const finale={...puzzle,id:'finale',title:'Finale',animation:{...animation,trigger:100}};
window.localStorage.setItem('after-hours-library',JSON.stringify([puzzle,finale]));
window.document.body.innerHTML='<div id="root"></div>';window.eval(readFileSync('dist/client.js','utf8'));
const wait=(ms=30)=>new Promise(r=>setTimeout(r,ms));await wait();
const doc=window.document,q=s=>doc.querySelector(s);
const button=t=>[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()===t);
const click=async el=>{assert.ok(el,'button exists');el.click();await wait()};
const key=async k=>{q('.grid').dispatchEvent(new window.KeyboardEvent('keydown',{key:k,bubbles:true}));await wait()};
const letters=()=>[...doc.querySelectorAll('.square .letter')].map(el=>el.textContent);
const stored=()=>JSON.parse(window.localStorage.getItem(saveKey));
const card=()=>[...doc.querySelectorAll('.puzzle-card')].find(c=>c.textContent.includes('Animated one'));

await click(button('My Puzzles'));assert.match(card().textContent,/ANIMATED/);await click(card().querySelector('.primary'));
for(const l of 'ABCD')await key(l);
assert.equal(q('.animation-stage'),null,'does not play before the trigger');
await key('E');
assert.ok(q('.grid-wrap .animation-stage canvas'),'plays inside the grid once 10% is filled');assert.ok(q('.animation-blocker'),'blocks clicks while playing');
assert.equal(stored().board.letters.filter(Boolean).length,5,'progress is saved before the animation plays');
const before=letters();
await key('Q');await key('Backspace');
assert.deepEqual(letters(),before,'typing is ignored while it plays');
await wait(450);
assert.equal(q('.animation-stage'),null,'the animation ends on its own');assert.equal(q('.animation-blocker'),null);
assert.deepEqual(letters(),before,'the board is exactly as the solver left it');
assert.deepEqual(stored().board.letters.filter(Boolean),['A','B','C','D','E']);assert.equal(stored().animated,true);
await key('F');assert.equal(letters().filter(Boolean).length,6,'solving continues');
await key('Backspace');await key('Backspace');await key('G');await key('H');
assert.equal(q('.animation-stage'),null,'plays only once, even when the trigger is crossed again');

const progress=stored().board.letters.filter(Boolean).length;

// At 100% the animation comes first, then the completion message.
await click(button('My Puzzles'));await click([...doc.querySelectorAll('.puzzle-card')].find(c=>c.textContent.includes('Finale')).querySelector('.primary'));
await click(button('Reveal ⌄'));await click(button('Reveal puzzle'));await click(button('Reveal answers'));
assert.ok(q('.animation-stage'));assert.equal(q('.modal'),null,'the completion message waits for the animation');
await wait(450);assert.equal(q('.animation-stage'),null);assert.match(q('.modal').textContent,/That’s a wrap/);
assert.equal(doc.querySelectorAll('.revealed').length,41);await click(button('Back to the puzzle'));

// The studio: draw, add a frame, and save it with the puzzle without touching the solve.
await click(button('Animation Studio'));
const pad=q('.pixel-pad canvas');
assert.equal(pad.width,16,'starts with a blank 16 × 16 canvas');assert.equal(q('.validation'),null);
// happy-dom has no layout, so give the pad a size: each animation pixel is 10 × 10 on screen.
pad.getBoundingClientRect=()=>({left:0,top:0,width:160,height:160});
const setValue=async(el,value)=>{Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new window.Event('input',{bubbles:true}));await wait()};
await setValue(q('[aria-label="Hex color"]'),'#ff8800');
const paint=async i=>{pad.dispatchEvent(new window.MouseEvent('pointerdown',{bubbles:true,clientX:i%16*10+5,clientY:Math.floor(i/16)*10+5}));window.dispatchEvent(new window.Event('pointerup'));await wait()};
// Exporting hands the browser an .ahanim file; reading it back shows exactly what the studio holds.
let exported;window.URL.createObjectURL=blob=>{exported=blob;return 'blob:exported'};window.URL.revokeObjectURL=()=>{};
const current=async()=>{await click(button('Export'));await wait(60);return decodeAnimation(new Uint8Array(await exported.arrayBuffer()))};
await paint(17);
let draft=await current();
assert.deepEqual(draft.palette,['#ff8800']);assert.deepEqual([...draft.frames[0]].flatMap((v,i)=>v?[i]:[]),[17]);
await click(button('◻ Erase'));await paint(17);assert.ok((await current()).frames[0].every(v=>v===0),'erased');await click(button('↶ Undo'));
await click(button('+ New frame'));await click(button('▧ Fill'));await paint(0);
await setValue(q('[aria-label="Canvas size"]'),'8');await click(button('New blank canvas'));await click(button('Cancel'));
draft=await current();
assert.equal(draft.frames.length,2);assert.deepEqual([...draft.frames[0]].flatMap((v,i)=>v?[i]:[]),[17]);assert.ok(draft.frames[1].every(v=>v===1));
assert.equal(doc.querySelectorAll('.frame').length,2);assert.match(q('.studio-frames > p').textContent,/2 of up to 3600/);
await click(button('▶ Preview'));assert.ok(q('.pixel-wrap .animation-stage'));await click(button('■ Stop'));assert.equal(q('.pixel-wrap .animation-stage'),null);
await setValue(q('.studio-settings label:nth-child(3) input'),'10');
await click(button('Save with puzzle →'));await wait(100);
const saved=JSON.parse(window.localStorage.getItem('after-hours-library')).find(p=>p.id==='animated');
assert.ok(saved,'saved with the selected puzzle');assert.equal(saved.animation.version,2,'the puzzle stores a reference, not the pixels');assert.match(saved.animation.id,/^[0-9a-f]{32}$/);
assert.equal(saved.animation.size,16);assert.equal(saved.animation.trigger,10);assert.equal(saved.animation.frames,2);assert.ok(saved.animation.bytes<300);assert.deepEqual(saved.cells,sample.cells);
assert.match(q('.creator-message').textContent,/Saved with “Animated one”/);
assert.equal(stored().board.letters.filter(Boolean).length,progress,'saving an animation keeps solving progress');
// Resetting the puzzle lets the stored animation play again, now loaded through its reference.
window.localStorage.removeItem(saveKey);
await click(button('My Puzzles'));await click(card().querySelector('.primary'));
for(const l of 'ABCDE')await key(l);
assert.ok(q('.grid-wrap .animation-stage canvas'),'the saved animation plays from its file');await wait(400);assert.equal(q('.animation-stage'),null);
console.log('PASS: animation plays once at the trigger, blocks input, restores and keeps progress; studio draws, fills, undoes, adds frames, previews, exports, and saves with the puzzle as a file reference that plays back.');
await window.happyDOM.abort();window.close();
