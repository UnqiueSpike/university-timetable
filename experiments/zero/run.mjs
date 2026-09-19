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
import { Zero, mustGetQuery } from '@rocicorp/zero';
import { handleQueryRequest } from '@rocicorp/zero/server';
import { schema, queries } from './schema.mjs';
import { testDatabase } from '../../app/tests/test-database.ts';
import { seedFixtures, fixtureUsers } from '../../app/src/server/db/seed.ts';
import { createAuth, authRequest } from '../../app/src/server/auth/auth.ts';
import { provisionTestAccounts } from '../../app/src/server/auth/provision-test-accounts.ts';
import { importTimetable } from '../../app/src/server/integrations/import-timetable.ts';
import { fixtureAdapter } from '../../app/src/server/integrations/fixture-adapter.ts';
const experiment = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(experiment, '../../app');
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
  server=createServer(async(req,res)=>{
    try {
      if(new URL(req.url,'http://127.0.0.1:4851').pathname!=='/query'){res.writeHead(403);res.end('Read-only spike');return;}
      const chunks=[]; for await(const chunk of req) chunks.push(chunk);
      const request=new Request(`http://127.0.0.1:4851${req.url}`,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)});
      // Only this Node test harness uses an opaque bearer token containing its local session cookie.
      const cookie=Buffer.from((request.headers.get('authorization')??'').replace(/^Bearer /,''),'base64url').toString();
      const session=await auth.api.getSession({headers:new Headers({cookie}),query:{disableCookieCache:true}}); requests++;
      if(!session) { denied++; res.writeHead(401);res.end('Unauthenticated');return; }
      const result=await handleQueryRequest({request,schema,userID:session.user.id,handler:(name,args)=>mustGetQuery(queries,name).fn({args,ctx:{id:session.user.id}})});
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(result));
    }catch(error){ console.error(error.message);res.writeHead(500);res.end('Query failed'); }
  });
  await new Promise(r=>server.listen(4851,'127.0.0.1',r));
  await database.pool.query('CREATE PUBLICATION unischedule_spike FOR TABLE timetable_entry, class, student_class, user_role');
  const upstream=database.pool.options.connectionString;
  const env={...process.env,ZERO_ADMIN_PASSWORD:password,ZERO_UPSTREAM_DB:upstream,ZERO_CVR_DB:upstream,ZERO_CHANGE_DB:upstream,ZERO_PORT:'4852',ZERO_QUERY_URL:'http://127.0.0.1:4851/query',ZERO_MUTATE_URL:'http://127.0.0.1:4851/mutate',ZERO_APP_ID:'unischedule_spike',ZERO_APP_PUBLICATIONS:'unischedule_spike',ZERO_REPLICA_FILE:resolve(temp,'zero.db'),ZERO_NUM_SYNC_WORKERS:'1',ZERO_LOG_LEVEL:'warn',ZERO_ENABLE_CRUD_MUTATIONS:'false',ZERO_ENABLE_TELEMETRY:'false'};
  cache=spawn(process.execPath,[resolve(experiment,'node_modules/@rocicorp/zero/out/zero/src/cli.js')],{cwd:temp,env,stdio:['ignore',log,log]});
  await until(async()=>{ try{if(cache.exitCode!==null) throw new Error('Zero process exited');return (await fetch('http://127.0.0.1:4852/')).ok;}catch{return false;} },'zero-cache startup');
  const cookies={a:await login('test-student-a'),b:await login('test-student-b')};
  function client(id,cookie){ const c=new Zero({schema,queries,userID:id,context:{id},auth:Buffer.from(cookie).toString('base64url'),cacheURL:'http://127.0.0.1:4852',kvStore:'mem',logLevel:'error'});clients.push(c);return c; }
  const a=client('test-student-a',cookies.a),b=client('test-student-b',cookies.b);
  const av=a.materialize(queries.mine()),bv=b.materialize(queries.mine());
  await until(()=>av.data.length===2&&bv.data.length===1,'initial client sync');
  assert.ok(av.data.every(r=>r.external_id.startsWith('comp-')));assert.ok(bv.data.every(r=>r.external_id.startsWith('math-'))); record('two authenticated clients receive only their own active classes');
  const spoof=client('test-student-b',cookies.a),spoofView=spoof.materialize(queries.mine());
  await until(()=>['needs-auth','error'].includes(spoof.connection.state.current.name),'forged client identity');
  assert.equal(spoofView.data.length,0);await spoof.close();record('forged client userID cannot override the authenticated session identity');

  const adapter=fixtureAdapter(); const batch=await adapter.load(); batch.version=2;batch.entries.find(r=>r.externalId==='comp-lecture-sep21').location='Zero write-path proof';
  await importTimetable(database.db,{...adapter,load:async()=>batch});
  await until(()=>av.data.some(r=>r.location==='Zero write-path proof'),'import path live update');record('existing importer -> PostgreSQL -> Zero -> authorized client');
  await database.pool.query("UPDATE student_class SET status='inactive' WHERE user_id='test-student-a'");
  await until(()=>av.data.length===0,'membership revocation');assert.equal(bv.data.length,1);record('membership revocation removes visible data without affecting other student');
  await database.pool.query("DELETE FROM user_role WHERE user_id='test-student-b'");
  await until(()=>bv.data.length===0,'role revocation');record('role revocation removes visible data');
  await a.close(); await authRequest(auth,new Request(`${origin}/api/auth/sign-out`,{method:'POST',headers:{Cookie:cookies.a,Origin:origin,'Content-Type':'application/json'},body:'{}'}));
  const before=requests;const stale=client('test-student-a',cookies.a);const staleView=stale.materialize(queries.mine());
  await until(()=>stale.connection.state.current.name==='needs-auth','reconnect after session invalidation');assert.equal(staleView.data.length,0);assert.ok(requests>before&&denied>0);record('new connection revalidates session and rejects logged-out credentials');
  await database.pool.query("UPDATE student_class SET status='active' WHERE user_id='test-student-a' AND class_id IN (SELECT id FROM class WHERE external_id IN ('comp-lecture','comp-lab'))");
  const fresh=await login('test-student-a');await stale.connection.connect({auth:Buffer.from(fresh).toString('base64url')});
  await until(()=>staleView.data.length===2,'reconnect with fresh authentication');record('reauthentication resumes authorized sync');
  // Drop the transport while preserving the same client and its in-memory cache.
  const disconnected=once(cache,'exit');cache.kill('SIGTERM');await disconnected;
  await until(()=>stale.connection.state.current.name!=='connected','transport disconnect');
  await authRequest(auth,new Request(`${origin}/api/auth/sign-out`,{method:'POST',headers:{Cookie:fresh,Origin:origin,'Content-Type':'application/json'},body:'{}'}));
  const deniedBefore=denied;
  cache=spawn(process.execPath,[resolve(experiment,'node_modules/@rocicorp/zero/out/zero/src/cli.js')],{cwd:temp,env,stdio:['ignore',log,log]});
  await until(()=>stale.connection.state.current.name==='needs-auth'&&denied>deniedBefore,'transport reconnect session validation',40000);
  record('same client after transport loss reauthenticates and rejects the revoked session');
  const retainedRows=staleView.data.length;
  results.push({name:'local cache on authentication failure',result:'OBSERVED',retainedRows,requirement:'Host must hide data and close the memory-only Zero instance on needs-auth/logout; Zero alone is not a UI revocation boundary.'});
  await stale.close();

} catch(error) { results.push({name:'experiment',result:'FAIL',reason:error.message}); console.error(error.message); console.error(readFileSync(resolve(temp,'zero.log'),'utf8').slice(-7000)); process.exitCode=1; }
finally {
  for(const c of clients) await c.close().catch(()=>{});
  if(cache&&!cache.killed){cache.kill('SIGTERM');await Promise.race([once(cache,'exit'),new Promise(r=>setTimeout(r,5000))]);}
  if(server) {server.closeAllConnections();await new Promise(r=>server.close(r));}
  if(database) await database.close().catch(()=>{});
  try{execFileSync('pg_ctl',['-D',resolve(temp,'data'),'-m','fast','-w','stop'],{stdio:'ignore'});}catch{}
  closeSync(log);
  writeFileSync(resolve(experiment,'results.json'),JSON.stringify({date:new Date().toISOString(),zero:'1.9.0',node:process.version,platform:process.platform,results},null,2)+'\n');
}
