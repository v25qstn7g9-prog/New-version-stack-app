import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const stock=fs.existsSync('functions/ask.js');
function setup(run){
 let calls=0, backupBodies=[], clock=Date.now();
 const sandbox={Response,Request,Headers,TextEncoder,AbortController,AbortSignal,URL,console,Date:class extends Date {static now(){return clock}},
 setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,20)),clearTimeout,
 fetch:async(url,init)=>{backupBodies.push(JSON.parse(init.body));return Response.json({candidates:[{content:{parts:[{text:'backup answer'}]}}]});}};
 vm.createContext(sandbox);
 vm.runInContext(fs.readFileSync(stock?'functions/ask.js':'src/app.js','utf8').replace(/export /g,''),sandbox);
 const env={AI:{run:async(...args)=>{calls++;return run(...args);}},GEMINI_API_KEY:'test-key'};
 async function ask(message='hello',extra={}){
 if(!stock)return sandbox.askTextAI(env,'system',message);
 const response=await sandbox.onRequestPost({env,request:new Request('https://app/ask',{method:'POST',body:JSON.stringify({message,context:'private marker',...extra})})});
 return response.json();
 }
 return {ask,get calls(){return calls},backupBodies,advance:ms=>{clock+=ms}};
}
test('transient failure uses backup and skips unhealthy primary on next call',async()=>{
 const s=setup(()=>{throw Error('429 quota exceeded')});
 assert.match((await s.ask('one')).provider,/gemini/i);
 assert.match((await s.ask('two')).provider,/gemini/i);
 assert.equal(s.calls,1);
 assert.match(JSON.stringify(s.backupBodies[0]),/one/);
});
test('stalled primary completes via backup within bounded time',async()=>{
 const s=setup(()=>new Promise(()=>{}));
 const result=await Promise.race([s.ask(),new Promise(resolve=>setTimeout(()=>resolve({provider:'STALLED'}),120))]);
 assert.match(result.provider,/gemini/i);
});
test('successful primary avoids backup',async()=>{
 const s=setup(()=>({response:'primary answer'}));
 const result=await s.ask();
 assert.match(result.provider,/cloudflare/i);assert.equal(s.backupBodies.length,0);
});
test('primary is retried after cooldown expires',async()=>{
 let healthy=false;
 const s=setup(()=>{if(!healthy)throw Error('503 unavailable');return {response:'recovered'}});
 await s.ask('before');healthy=true;s.advance(31000);
 assert.match((await s.ask('after')).provider,/cloudflare/i);
 assert.equal(s.calls,2);
});
if(stock)test('explicit consent preserves private tool evidence for backup',async()=>{
 const s=setup(()=>{throw Error('429 quota')});
 const result=await s.ask('private',{allowGeminiPrivate:true,toolTurns:[{calls:[{id:'1',name:'query_app_data'}],results:[{id:'1',content:'AUTHORIZED_ASSET'}]}]});
 assert.match(result.provider,/gemini/i);assert.match(JSON.stringify(s.backupBodies),/AUTHORIZED_ASSET/);
});
if(stock)test('private tool results cannot cross to Gemini without consent',async()=>{
 const s=setup(()=>{throw Error('429 quota')});
 const result=await s.ask('private',{toolTurns:[{calls:[{id:'1',name:'query_app_data'}],results:[{id:'1',content:'SECRET_ASSET'}]}]});
 assert.ok(result.error);assert.equal(s.backupBodies.length,0);
});
