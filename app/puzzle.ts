import {parseAnimation,type Animation} from './animation.ts';
export const rows = ['APP#ERA','DOE#DEN','SPOTIFY','##PET##','MOLDOVA','ARE#RIP','YES#SAT'];
export const solution = rows.join('').split('');
export type Entry = { id: string; number: number; direction: 'Across'|'Down'; cells: number[]; answer: string; clue: string };
const clues: Record<string,string> = {
'0Across':'Where a dating profile or a daily streak lives', '0Down':'The reason you finally paid for Premium',
'1Down':'Sabrina Carpenter’s musical lane', '2Down':'“___ Choice Awards” (fans do the voting)',
'4Across':'“In my self-care ___”', '4Down':'People who turn your chaotic footage into a polished video',
'5Down':'Person who can give you a red card, for short', '6Down':'“Pick a movie.” “___ movie?”',
'7Across':'Jane ___, a placeholder name', '11Across':'Cozy room for a gaming setup',
'14Across':'Your Wrapped comes from this app', '17Down':'___ Talks, a rabbit hole of big ideas',
'23Across':'Your camera roll’s furry main character', '28Across':'European country between Romania and Ukraine',
'28Down':'Graduation month for many college seniors', '29Down':'Minecraft material you might mine for iron',
'33Down':'By way of, as in “sent ___ DM”', '34Down':'Rental listing abbreviation',
'35Across':'“We ___ so back”', '39Across':'“___ my sleep schedule”',
'42Across':'Answer you hope for after “Want to get coffee?”', '46Across':'College entrance exam you’re glad is behind you'
};
export type Puzzle = { version: 1; id: string; title: string; author: string; size: number; cells: string[]; clues: Record<string,string>; animation?: Animation };
export function derive(puzzle: Puzzle) {
 const numbers: Record<number,number> = {}, entries: Entry[] = [];
 const {size,cells} = puzzle;
 let n=0;
 cells.forEach((v,i)=>{
  if(v==='#')return;
  const r=Math.floor(i/size), c=i%size;
  const starts = [c===0||cells[i-1]==='#',r===0||cells[i-size]==='#'];
  const found: {direction:'Across'|'Down';cells:number[]}[]=[];
  for(const [axis,direction] of (['Across','Down'] as const).entries()){
   if(!starts[axis])continue;
   const run:number[]=[];
   for(let j=i;j<cells.length&&cells[j]!=='#'&&(axis===1||Math.floor(j/size)===r);j+=axis===0?1:size)run.push(j);
   if(run.length>1)found.push({direction,cells:run});
  }
  if(found.length)numbers[i]=++n;
  for(const e of found)entries.push({...e,id:`${n}${e.direction}`,number:n,answer:e.cells.map(j=>cells[j]||'·').join(''),clue:puzzle.clues[`${i}${e.direction}`]||''});
 });
 return {numbers,entries};
}
export const sample: Puzzle = {version:1,id:'sample',title:'Twenty-something',author:'After Hours',size:7,cells:solution,clues};
export const {numbers,entries}=derive(sample);
export const blank=()=>solution.map(()=> '');
export function parsePuzzle(value: unknown): Puzzle {
 if(!value||typeof value!=='object')throw new Error('Choose an After Hours puzzle JSON file.');
 const p=value as Puzzle;
 if(p.version!==1||!Number.isInteger(p.size)||p.size<3||p.size>21||!Array.isArray(p.cells)||p.cells.length!==p.size*p.size||p.cells.some(c=>typeof c!=='string'||!/^([A-Z]{1,12}|#|)$/.test(c))||!p.clues||typeof p.clues!=='object'||Array.isArray(p.clues)||Object.values(p.clues).some(c=>typeof c!=='string'||c.length>500)||typeof p.title!=='string'||p.title.length>100||typeof p.author!=='string'||p.author.length>100)throw new Error('Invalid puzzle. Use a square grid (3–21), letters or # blocks, and text clues.');
 // The animation is optional and never part of progressKey, so adding or changing one keeps a solver's progress.
 return {version:1,id:typeof p.id==='string'?p.id:crypto.randomUUID(),title:p.title,author:p.author,size:p.size,cells:[...p.cells],clues:{...p.clues},...(p.animation?{animation:parseAnimation(p.animation)}:{})};
}
export function validate(p: Puzzle): string[] {
 const issues:string[]=[];const {entries}=derive(p);
 if(!p.title.trim())issues.push('Give your puzzle a title.');
 if(p.cells.some(c=>c===''))issues.push('Fill every white square with an answer letter.');
 if(!entries.length)issues.push('Add at least one answer of two or more letters.');
 const uncovered=p.cells.some((c,i)=>c!=='#'&&!entries.some(e=>e.cells.includes(i)));
 if(uncovered)issues.push('Remove isolated squares or connect them to an answer.');
 const missing=entries.filter(e=>!e.clue.trim());if(missing.length)issues.push(`Write clues for ${missing.length} remaining entries.`);
 const start=p.cells.findIndex(c=>c!=='#'),seen=new Set<number>();const queue=start<0?[]:[start];
 for(const i of queue){if(seen.has(i))continue;seen.add(i);for(const j of [i-p.size,i+p.size,...(i%p.size?[i-1]:[]),...(i%p.size<p.size-1?[i+1]:[])])if(j>=0&&j<p.cells.length&&p.cells[j]!=='#'&&!seen.has(j))queue.push(j);}
 if(seen.size!==p.cells.filter(c=>c!=='#').length)issues.push('Connect all white squares into one grid.');
 return issues;
}
export function progressKey(p: Puzzle) {
 if(p.id==='sample')return 'after-hours-v1';
 let hash=2166136261;for(const c of JSON.stringify([p.size,p.cells,p.clues]))hash=Math.imul(hash^c.charCodeAt(0),16777619);
 return `after-hours-progress-${p.id}-${hash>>>0}`;
}
export type Pair={answer:string;clue:string};
export function parsePairs(text:string):Pair[]{
 const pairs=text.split(/\r?\n/).filter(l=>l.trim()).map((line,index)=>{
  const at=line.indexOf('|');if(at<1)throw new Error(`Line ${index+1}: use ANSWER | clue.`);
  const answer=line.slice(0,at).trim().toUpperCase().replace(/[ '\-]/g,''),clue=line.slice(at+1).trim();
  if(!/^[A-Z]{2,21}$/.test(answer)||!clue||clue.length>500)throw new Error(`Line ${index+1}: use a 2–21 letter answer and a clue (up to 500 characters).`);
  return {answer,clue};
 });
 if(!pairs.length||pairs.length>60)throw new Error('Enter between 1 and 60 answer–clue pairs.');
 if(new Set(pairs.map(p=>p.answer)).size!==pairs.length)throw new Error('Each answer must be unique.');
 return pairs;
}
export function generate(pairs:Pair[],base:Pick<Puzzle,'id'|'title'|'author'>,size=21):{puzzle:Puzzle;unplaced:string[]}{
 let best:{cells:string[];placed:{pair:Pair;r:number;c:number;vertical:boolean}[]}|undefined;
 for(let attempt=0;attempt<24;attempt++){
  const cells=Array(size*size).fill('#') as string[];const placed:{pair:Pair;r:number;c:number;vertical:boolean}[]=[];
  const sorted=[...pairs].sort((a,b)=>b.answer.length-a.answer.length);
  if(attempt)sorted.push(...sorted.splice(0,attempt%Math.min(sorted.length,5)));
  let pending=[...sorted];
  for(let pass=0;pass<3;pass++){
   const remaining:Pair[]=[];
   for(const pair of pending){
    let chosen:{r:number;c:number;vertical:boolean;score:number}|undefined;
    for(const vertical of [false,true])for(let r=0;r<size;r++)for(let c=0;c<size;c++){
     const dr=vertical?1:0,dc=vertical?0:1,len=pair.answer.length;
     if(r+dr*(len-1)>=size||c+dc*(len-1)>=size)continue;
     const at=(rr:number,cc:number)=>rr<0||cc<0||rr>=size||cc>=size?'#':cells[rr*size+cc];
     if(at(r-dr,c-dc)!=='#'||at(r+dr*len,c+dc*len)!=='#')continue;
     let crosses=0,ok=true;
     for(let k=0;k<len;k++){
      const rr=r+dr*k,cc=c+dc*k,old=at(rr,cc);
      if(old!=='#'){
       if(old!==pair.answer[k]||placed.some(p=>p.vertical===vertical&&Array.from({length:p.pair.answer.length},(_,j)=>(p.r+(p.vertical?j:0))*size+p.c+(p.vertical?0:j)).includes(rr*size+cc))){ok=false;break}crosses++;
      }else if(at(rr-dc,cc-dr)!=='#'||at(rr+dc,cc+dr)!=='#'){ok=false;break}
     }
     if(!ok||(placed.length&&crosses===0))continue;
     const score=crosses*100-Math.abs(r+dr*(len-1)/2-(size-1)/2)-Math.abs(c+dc*(len-1)/2-(size-1)/2)+(vertical?0:.1);
     if(!chosen||score>chosen.score)chosen={r,c,vertical,score};
    }
    if(!chosen){remaining.push(pair);continue}
    const {r,c,vertical}=chosen;for(let k=0;k<pair.answer.length;k++)cells[(r+(vertical?k:0))*size+c+(vertical?0:k)]=pair.answer[k];placed.push({pair,r,c,vertical});
   }
   pending=remaining;
  }
  if(!best||placed.length>best.placed.length)best={cells,placed};
  if(placed.length===pairs.length)break;
 }
 const {cells,placed}=best!;const white=cells.map((c,i)=>c==='#'?-1:i).filter(i=>i>=0);
 const minR=Math.min(...white.map(i=>Math.floor(i/size))),maxR=Math.max(...white.map(i=>Math.floor(i/size))),minC=Math.min(...white.map(i=>i%size)),maxC=Math.max(...white.map(i=>i%size));
 const side=Math.max(3,maxR-minR+1,maxC-minC+1),offR=Math.floor((side-(maxR-minR+1))/2),offC=Math.floor((side-(maxC-minC+1))/2);
 const output=Array(side*side).fill('#') as string[],clues:Record<string,string>={};
 for(const i of white)output[(Math.floor(i/size)-minR+offR)*side+(i%size-minC+offC)]=cells[i];
 for(const p of placed)clues[`${(p.r-minR+offR)*side+p.c-minC+offC}${p.vertical?'Down':'Across'}`]=p.pair.clue;
 return {puzzle:{version:1,...base,size:side,cells:output,clues},unplaced:pairs.filter(p=>!placed.some(v=>v.pair===p)).map(p=>p.answer)};
}
