import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=process.cwd();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
http.createServer(async(req,res)=>{
    try {
        const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
        const file=pathname==='/'?'index.html':pathname.slice(1);
        if (!['index.html','admin.html','about.html','conferences.json'].includes(file) && !/^assets\/[a-zA-Z0-9_./-]+$/.test(file)) {
            res.writeHead(404).end();return;
        }
        const path=resolve(root,file);
        if (!path.startsWith(root+sep)) {res.writeHead(403).end();return;}
        const content=await readFile(path);
        res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'}).end(content);
    } catch {res.writeHead(404).end();}
}).listen(4173,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:4173'));
