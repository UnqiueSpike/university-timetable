// Isolated local experiment: never points at the development or production database.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, openSync, closeSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { Zero } from '@rocicorp/zero';
import { syncRequest } from '../src/server/sync/handler.ts';
import { syncToken } from '../src/server/sync/auth.ts';
import { trpcRequest } from '../src/server/api/handler.ts';
import { syncSchema as schema, syncQueries as queries } from '../src/lib/sync/schema.ts';
import { testDatabase } from '../tests/test-database.ts';
import { seedFixtures, fixtureUsers } from '../src/server/db/seed.ts';
import { createAuth, authRequest } from '../src/server/auth/auth.ts';
import { provisionTestAccounts } from '../src/server/auth/provision-test-accounts.ts';
import { importTimetable } from '../src/server/integrations/import-timetable.ts';
import { fixtureAdapter } from '../src/server/integrations/fixture-adapter.ts';
const experiment = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(experiment, '..');
const temp = mkdtempSync(resolve(tmpdir(), 'unischedule-zero-'));
const password = randomBytes(24).toString('hex');
writeFileSync(resolve(temp,'pw'), password, { mode:0o600 });
let database, cache, server; const clients = [];
const log = openSync(resolve(temp,'zero.log'),'a');
const results = [];
const record = (name) => { results.push({name,result:'PASS'}); console.log(`PASS: ${name}`); };
async function until(check, name, timeout = 25000) { const start=Date.now(); while(Date.now()-start<timeout) { if(await check()) return; await new Promise(r=>setTimeout(r,100)); } throw new Error(`Timed out: ${name}`); }
const origin='http://127.0.0.1:3000';
try {
  execFileSync('initdb',['-D',resolve(temp,'data'),'-U','unischedule','--auth=scram-sha-256',`--pwfile=${resolve(temp,'pw')}`,'--encoding=UTF8','--locale=C'],{stdio:'ignore'});
  execFileSync('pg_ctl',['-D',resolve(temp,'data'),'-l',resolve(temp,'postgres.log'),'-o',"-h 127.0.0.1 -p 55433 -k '' -c wal_level=logical",'-w','start'],{stdio:'ignore'});
  process.env.TEST_DATABASE_URL=`postgresql://unischedule:${password}@127.0.0.1:55433/unischedule_test`;
  process.chdir(root);
  database=await testDatabase(); await seedFixtures(database.db);
  const auth=createAuth(database.db,{secret:randomBytes(48).toString('hex'),baseURL:origin});
  await provisionTestAccounts(database.db,auth,Object.fromEntries(fixtureUsers.map(u=>[u.id,password])));
  async function login(id) { const person=fixtureUsers.find(u=>u.id===id); const response=await authRequest(auth,new Request(`${origin}/api/auth/sign-in/email`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:person.email,password})})); assert.equal(response.status,200); return response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '); }
  let requests=0, denied=0;
  const secret=(await auth.$context).secret;
  server=createServer(async(req,res)=>{
    try{
      if(new URL(req.url,'http://127.0.0.1:4851').pathname!=='/query'){res.writeHead(403);res.end('Read only');return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const request=new Request(`http://127.0.0.1:4851${req.url}`,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)});
      requests++;const result=await syncRequest(request,database.db,secret);if(result.status===401)denied++;
      res.writeHead(result.status,{'Content-Type':'application/json'});res.end(await result.text());
    }catch(error){console.error(error.message);res.writeHead(500);res.end('Query failed');}
  });
  await new Promise(r=>server.listen(4851,'127.0.0.1',r));
  await database.pool.query('CREATE PUBLICATION unischedule_spike FOR TABLE sync_signal');
  const upstream=database.pool.options.connectionString;
  const env={...process.env,ZERO_ADMIN_PASSWORD:password,ZERO_UPSTREAM_DB:upstream,ZERO_CVR_DB:upstream,ZERO_CHANGE_DB:upstream,ZERO_PORT:'4852',ZERO_QUERY_URL:'http://127.0.0.1:4851/query',ZERO_MUTATE_URL:'http://127.0.0.1:4851/mutate',ZERO_APP_ID:'unischedule_spike',ZERO_APP_PUBLICATIONS:'unischedule_spike',ZERO_REPLICA_FILE:resolve(temp,'zero.db'),ZERO_NUM_SYNC_WORKERS:'1',ZERO_LOG_LEVEL:'warn',ZERO_ENABLE_CRUD_MUTATIONS:'false',ZERO_ENABLE_TELEMETRY:'false'};
  cache=spawn(process.execPath,[resolve(root,'node_modules/@rocicorp/zero/out/zero/src/cli.js')],{cwd:temp,env,stdio:['ignore',log,log]});
  await until(async()=>{ try{if(cache.exitCode!==null) throw new Error('Zero process exited');return (await fetch('http://127.0.0.1:4852/')).ok;}catch{return false;} },'zero-cache startup');
  const cookies={a:await login('test-student-a'),b:await login('test-student-b'),teacher:await login('test-teacher')};
  async function token(cookie){const current=await auth.api.getSession({headers:new Headers({cookie}),query:{disableCookieCache:true}});return syncToken(current.user.id,current.session.id,secret);}
  function client(id,authToken){const c=new Zero({schema,userID:id,context:{id},auth:authToken,cacheURL:'http://127.0.0.1:4852',kvStore:'mem',logLevel:'error'});clients.push(c);return c;}
  async function rpc(path,input,cookie,write=false){const r=await trpcRequest(new Request(`${origin}/api/trpc/${path}${write?'':`?input=${encodeURIComponent(JSON.stringify(input))}`}`,{method:write?'POST':'GET',headers:{cookie,Origin:origin,'Content-Type':'application/json'},...(write?{body:JSON.stringify(input)}:{})}),{db:database.db,auth});return {status:r.status,body:await r.json()};}
  const range={from:'2026-09-20T00:00:00Z',to:'2026-09-23T00:00:00Z'};
  const a=client('test-student-a',await token(cookies.a)),b=client('test-student-b',await token(cookies.b));
  const av=a.materialize(queries.mine()),bv=b.materialize(queries.mine());
  await until(()=>av.data.length===1&&bv.data.length===1,'authenticated signal subscription');
  assert.deepEqual(Object.keys(av.data[0]).sort(),['revision','user_id']);assert.equal(av.data[0].user_id,'test-student-a');assert.equal(bv.data[0].user_id,'test-student-b');record('Zero exposes only the current user opaque signal; no course, announcement or shared fields');
  const spoof=client('test-student-b',await token(cookies.a)),sv=spoof.materialize(queries.mine());await until(()=>['needs-auth','error'].includes(spoof.connection.state.current.name),'spoof rejected');assert.equal(sv.data.length,0);await spoof.close();record('forged Zero userID is rejected by the real session-bound endpoint');
  let aData,bData,aAnnouncements=[],shared,sharedId;let started=Date.now();
  const measure=[];
  av.addListener(async(_rows,type)=>{if(type!=='complete')return;aData=await rpc('timetable.mine',range,cookies.a);aAnnouncements=(await rpc('announcement.listVisible',{},cookies.a)).body.result?.data.items??[];});
  bv.addListener(async(_rows,type)=>{if(type!=='complete')return;bData=await rpc('timetable.mine',range,cookies.b);if(sharedId)shared=await rpc('share.read',{shareId:sharedId,...range},cookies.b);});
  await until(()=>aData?.status===200&&bData?.status===200,'initial authorized read');
  const entry=aData.body.result.data.items[0];
  started=Date.now();const saved=await rpc('supplement.save',{entryId:entry.id,content:'Live test note'},cookies.teacher,true);assert.equal(saved.status,200);
  await until(()=>aData.body.result.data.items.some(e=>e.supplements.some(s=>s.content==='Live test note')),'staff write visible');measure.push({scenario:'staff supplement -> A',ms:Date.now()-started});assert.ok(bData.body.result.data.items.every(e=>!e.supplements.length));record('tRPC/Drizzle supplement commit automatically refreshes only authorized content');
  const draft=await rpc('announcement.create',{title:'Live class notice',body:'Synthetic notice',targets:[{type:'class',classId:entry.classId}]},cookies.teacher,true);assert.equal(draft.status,200);assert.equal(aAnnouncements.length,0);
  started=Date.now();await rpc('announcement.publish',{announcementId:draft.body.result.data.id,expectedRevision:1},cookies.teacher,true);await until(()=>aAnnouncements.length===1,'announcement publish');measure.push({scenario:'announcement publish -> A',ms:Date.now()-started});assert.equal((await rpc('announcement.listVisible',{},cookies.b)).body.result.data.items.length,0);
  await rpc('announcement.withdraw',{announcementId:draft.body.result.data.id,expectedRevision:2},cookies.teacher,true);await until(()=>aAnnouncements.length===0,'announcement withdrawal');record('targeted announcements appear on publish and disappear on withdrawal');
  const created=await rpc('share.create',{...range,recipientId:'test-student-b',allowedFields:['startAt','endAt'],expiresAt:new Date(Date.now()+86400000).toISOString(),consent:true},cookies.a,true);sharedId=created.body.result.data.id;shared=await rpc('share.read',{shareId:sharedId,...range},cookies.b);assert.equal(shared.status,200);assert.deepEqual(Object.keys(shared.body.result.data.items[0]).sort(),['endAt','id','startAt']);
  const adapter=fixtureAdapter(),batch=await adapter.load();batch.version=2;batch.entries.find(e=>e.externalId==='comp-lecture-sep21').location='Updated source';await importTimetable(database.db,{...adapter,load:async()=>batch});await until(()=>aData.body.result.data.items.some(e=>e.location==='Updated source'),'importer refresh');record('import adapter writes use the same transactional signal path');
  started=Date.now();await rpc('share.revoke',{shareId:sharedId},cookies.a,true);await until(()=>shared?.status===404,'share revocation refresh');measure.push({scenario:'share revoke -> B',ms:Date.now()-started});record('sharing revocation triggers recipient refresh and removes subsequent access');
  const old=av.data[0].revision;const connection=await database.pool.connect();try{await connection.query('BEGIN');await connection.query("UPDATE timetable_entry SET location='Must rollback'");await connection.query('ROLLBACK');}finally{connection.release();}
  await new Promise(r=>setTimeout(r,300));assert.equal(av.data[0].revision,old);record('rolled back database writes produce no Zero success signal');
  await database.pool.query("UPDATE student_class SET status='inactive' WHERE user_id='test-student-a'");await until(()=>aData.body.result.data.items.length===0,'membership revocation');assert.equal(bData.body.result.data.items.length,1);record('membership revocation clears former timetable rows');
  await database.pool.query("DELETE FROM user_role WHERE user_id='test-student-b'");await until(()=>bData.status===403,'role revocation');record('role revocation invalidates protected queries');
  const disconnected=once(cache,'exit');cache.kill('SIGTERM');await disconnected;await until(()=>a.connection.state.current.name!=='connected','transport lost');
  await authRequest(auth,new Request(`${origin}/api/auth/sign-out`,{method:'POST',headers:{Cookie:cookies.a,Origin:origin,'Content-Type':'application/json'},body:'{}'}));
  cache=spawn(process.execPath,[resolve(root,'node_modules/@rocicorp/zero/out/zero/src/cli.js')],{cwd:temp,env,stdio:['ignore',log,log]});
  await until(()=>a.connection.state.current.name==='needs-auth'&&denied>0,'revoked session rejected on reconnect',40000);record('transport reconnection revalidates the database session');
  const fresh=await login('test-student-a');await a.connection.connect({auth:await token(fresh)});await until(()=>a.connection.state.current.name==='connected','fresh authentication');record('fresh authentication resumes the signal subscription');
  assert.ok(measure.every(r=>r.ms<=5000));results.push({name:'local latency evidence',result:'PASS',conditions:'PostgreSQL 18.6 + Zero 1.9.0, localhost, two separate memory clients, synthetic data; client refresh occurs only on Zero signals in this test',measure,targetMs:5000,customerSla:'pending confirmation',queryRequests:requests});

} catch(error) { results.push({name:'experiment',result:'FAIL',reason:error.message}); console.error(error.message); console.error(readFileSync(resolve(temp,'zero.log'),'utf8').slice(-7000)); process.exitCode=1; }
finally {
  for(const c of clients) await Promise.race([c.close().catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);
  if(cache&&!cache.killed){cache.kill('SIGTERM');await Promise.race([once(cache,'exit'),new Promise(r=>setTimeout(r,5000))]);}
  if(server) {server.closeAllConnections();await new Promise(r=>server.close(r));}
  if(database) await database.close().catch(()=>{});
  try{execFileSync('pg_ctl',['-D',resolve(temp,'data'),'-m','fast','-w','stop'],{stdio:'ignore'});}catch{}
  closeSync(log);
  writeFileSync(resolve(root,'docs/sync-results.json'),JSON.stringify({date:new Date().toISOString(),zero:'1.9.0',node:process.version,platform:process.platform,results},null,2)+'\n');
}
