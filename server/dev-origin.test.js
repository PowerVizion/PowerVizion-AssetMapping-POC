import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {devCors,allowedDevOrigin} from './dev-origin.js';
test('only the two exact local development origins receive CORS authorization',async()=>{
 const app=express();app.use(devCors);app.get('/api/test',(req,res)=>res.json({ok:true}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const url='http://127.0.0.1:'+server.address().port+'/api/test';
 try{for(const origin of ['http://127.0.0.1:5173','http://localhost:5173']){assert.equal(allowedDevOrigin(origin),true);const get=await fetch(url,{headers:{Origin:origin}});assert.equal(get.status,200);assert.equal(get.headers.get('access-control-allow-origin'),origin);assert.match(get.headers.get('vary'),/Origin/);const preflight=await fetch(url,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Content-Type, Range'}});assert.equal(preflight.status,204);assert.match(preflight.headers.get('access-control-allow-headers'),/Range/);}
 for(const origin of ['https://example.org','http://localhost:5174','http://localhost:5173.evil.test','null']){assert.equal(allowedDevOrigin(origin),false);const get=await fetch(url,{headers:{Origin:origin}});assert.equal(get.headers.get('access-control-allow-origin'),null);assert.equal((await fetch(url,{method:'OPTIONS',headers:{Origin:origin}})).status,403);}
 assert.equal((await fetch(url)).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
