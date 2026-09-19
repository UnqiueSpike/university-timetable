import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Pool, type QueryResult} from "pg";
import {connectDatabase} from "../src/server/db/connection";
import {appRouter} from "../src/server/api/router";
import {testDatabase} from "../tests/test-database";
import {seedFixtures,fixtureUsers} from "../src/server/db/seed";
import {createAuth,authRequest} from "../src/server/auth/auth";
import {provisionTestAccounts} from "../src/server/auth/provision-test-accounts";
const source=await testDatabase(),name=`unischedule_restore_${randomUUID().replaceAll('-','')}`;
const sourceUrl=new URL(source.pool.options.connectionString!),targetUrl=new URL(sourceUrl);targetUrl.pathname=`/${name}`;
const adminUrl=new URL(sourceUrl);adminUrl.pathname='/postgres';const admin=new Pool({connectionString:adminUrl.toString()});let target:Pool|undefined;
const temp=mkdtempSync(join(tmpdir(),'unischedule-restore-')),file=join(temp,'backup.dump'),start=Date.now();
function args(url:URL){return ['--host',url.hostname,'--port',url.port,'--username',decodeURIComponent(url.username),'--dbname',url.pathname.slice(1)];}
try{
 await seedFixtures(source.db);const secret=randomBytes(40).toString('hex'),password=randomBytes(24).toString('hex');const auth=createAuth(source.db,{secret,baseURL:'http://127.0.0.1:3000'});await provisionTestAccounts(source.db,auth,Object.fromEntries(fixtureUsers.map(u=>[u.id,password])));
 const signIn=await authRequest(auth,new Request('http://127.0.0.1:3000/api/auth/sign-in/email',{method:'POST',headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/json'},body:JSON.stringify({email:'student-a@example.invalid',password})}));
 const cookie=signIn.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const caller=appRouter.createCaller({db:source.db,auth,headers:new Headers({cookie,origin:'http://127.0.0.1:3000'}),requestId:randomUUID()});
 await caller.share.create({recipientId:'test-student-b',from:'2026-09-20T00:00:00Z',to:'2026-09-23T00:00:00Z',allowedFields:['startAt','endAt'],expiresAt:new Date(Date.now()+86400000).toISOString(),consent:true});
 execFileSync('pg_dump',[...args(sourceUrl),'-Fc','--no-owner','--no-acl','-f',file],{env:{...process.env,PGPASSWORD:decodeURIComponent(sourceUrl.password)},stdio:'pipe'});chmodSync(file,0o600);
 await admin.query(`CREATE DATABASE "${name}"`);target=new Pool({connectionString:targetUrl.toString()});
 execFileSync('pg_restore',[...args(targetUrl),'--no-owner','--no-acl','--exit-on-error',file],{env:{...process.env,PGPASSWORD:decodeURIComponent(targetUrl.password)},stdio:'pipe'});
 const tables=['user','account','session','course','class','student_class','timetable_entry','capacity_snapshot','staff_permission','share_recipient','share','sync_signal'];
 for(const table of tables){const a:QueryResult=await source.pool.query(`SELECT * FROM "${table}" ORDER BY 1`);const b:QueryResult=await target.query(`SELECT * FROM "${table}" ORDER BY 1`);assert.deepEqual(b.rows,a.rows);}
 const constraints=await target.query("SELECT count(*)::int AS n FROM pg_constraint WHERE connamespace='public'::regnamespace");assert.ok(constraints.rows[0].n>50);
 // Restores must not revive sessions or previously revoked shares.
 await target.query("BEGIN; DELETE FROM session; UPDATE share SET revoked_at=coalesce(revoked_at,now()); COMMIT");
 const restored=connectDatabase(targetUrl.toString());try{const restoredAuth=createAuth(restored.db,{secret,baseURL:'http://127.0.0.1:3000'});const denied=await restoredAuth.api.getSession({headers:new Headers({cookie}),query:{disableCookieCache:true}});assert.equal(denied,null);const active=await target.query('SELECT count(*)::int AS n FROM share WHERE revoked_at IS NULL');assert.equal(active.rows[0].n,0);}finally{await restored.pool.end();}
 writeFileSync('docs/restore-results.json',JSON.stringify({date:new Date().toISOString(),result:'PASS',database:'PostgreSQL 18 local isolated databases',tablesCompared:tables,elapsedMs:Date.now()-start,checks:['empty target restored from pg_dump custom archive','rows and hashed account data preserved','constraints restored','sessions cleared and shares revoked before reopening'],limitations:['AWS RDS point-in-time recovery not executed','university operators must reconcile authorization changes after the backup point']},null,2)+'\n');
 console.log('Backup and restore drill passed; temporary databases will be removed.');
}finally{await target?.end();await admin.query(`DROP DATABASE IF EXISTS "${name}"`);await admin.end();await source.close();}
