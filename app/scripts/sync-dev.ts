import {spawn} from "node:child_process";
import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {randomBytes} from "node:crypto";
import {Pool} from "pg";
import {databaseUrl,requireLocalDatabase} from "./env";
const url=requireLocalDatabase(databaseUrl(),"dev"),pool=new Pool({connectionString:url.toString()});
try{
 const {rows}=await pool.query('SHOW wal_level');if(rows[0].wal_level!=='logical')throw Error('Restart local PostgreSQL with db:down then db:up to enable logical replication');
 const existing=await pool.query("SELECT 1 FROM pg_publication WHERE pubname='unischedule_sync'");
 if(!existing.rowCount)await pool.query('CREATE PUBLICATION unischedule_sync FOR TABLE sync_signal');
 else await pool.query('ALTER PUBLICATION unischedule_sync SET TABLE sync_signal');
}finally{await pool.end();}
const dir=resolve('.local-zero');mkdirSync(dir,{recursive:true,mode:0o700});
const child=spawn(process.execPath,[resolve('node_modules/@rocicorp/zero/out/zero/src/cli.js')],{cwd:dir,stdio:'inherit',env:{...process.env,ZERO_ADMIN_PASSWORD:randomBytes(32).toString('hex'),ZERO_UPSTREAM_DB:url.toString(),ZERO_CVR_DB:url.toString(),ZERO_CHANGE_DB:url.toString(),ZERO_PORT:'4848',ZERO_QUERY_URL:'http://127.0.0.1:3000/api/sync/query',ZERO_MUTATE_URL:'http://127.0.0.1:3000/api/sync/mutate',ZERO_APP_ID:'unischedule',ZERO_APP_PUBLICATIONS:'unischedule_sync',ZERO_REPLICA_FILE:resolve(dir,'replica.db'),ZERO_NUM_SYNC_WORKERS:'1',ZERO_ENABLE_CRUD_MUTATIONS:'false',ZERO_ENABLE_TELEMETRY:'false',ZERO_LOG_LEVEL:'warn'}});
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??0;});
