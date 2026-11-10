import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
const root=resolve('dist');
createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');const file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(!file.startsWith(root+'/')){res.writeHead(403).end();return}const data=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream'});res.end(data)}catch{res.writeHead(404).end('Not found')}}).listen(3000,'127.0.0.1',()=>console.log('After Hours: http://localhost:3000'));
