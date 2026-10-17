import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readAppSource } from './_app-source.mjs';
test('response body timeout is bounded and does not retry POST',async()=>{
 const source=readAppSource().match(/async function fetchWithTimeout\([\s\S]*?\n}\n/)[0];
 let calls=0;
 const ctx={Response,AbortController,setTimeout,clearTimeout,fetch:async()=>{calls++;return {status:200,headers:new Headers(),arrayBuffer:()=>new Promise(()=>{})};}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 await assert.rejects(()=>ctx.fetchWithTimeout('/ask',{method:'POST'},5),/逾時/);
 assert.equal(calls,1);
});
