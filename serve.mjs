import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {Readable} from 'node:stream';
const root=resolve('dist');
// Local stand-in for Vercel Functions: /api/<name> runs the handler that build.mjs bundled from api/<name>.ts.
async function api(req,res,name){const mod=await import(`./.server/api/${name}.mjs`).catch(()=>null);if(!mod){res.writeHead(404).end('Not found');return}const handler=mod[req.method];if(!handler){res.writeHead(405).end();return}const body=['GET','HEAD'].includes(req.method)?undefined:Readable.toWeb(req);const response=await handler(new Request(new URL(req.url,`http://${req.headers.host}`),{method:req.method,headers:req.headers,body,duplex:'half'}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))}
createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const route=/^\/api\/([a-z]+)$/.exec(url.pathname);if(route)return await api(req,res,route[1]);const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+'/')){res.writeHead(403).end();return}const data=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});res.end(data)}catch{if(!res.headersSent)res.writeHead(404).end('Not found')}}).listen(3000,'127.0.0.1',()=>console.log('After Hours: http://localhost:3000'));
