"use client";
import {createContext,useContext,useEffect,useState} from "react";
import {Zero} from "@rocicorp/zero";
import {syncSchema,syncQueries} from "@/lib/sync/schema";
const SyncRevision=createContext(0);
export const useSyncRevision=()=>useContext(SyncRevision);
export function SyncProvider({userId,children}:{userId:string;children:React.ReactNode}){
 const cacheURL=process.env.NEXT_PUBLIC_ZERO_CACHE_URL;
 const [revision,setRevision]=useState(0),[attempt,setAttempt]=useState(0),[state,setState]=useState(cacheURL?'Connecting updates…':'Updates not configured; use Refresh.');
 const [ready,setReady]=useState(!cacheURL);
 useEffect(()=>{
  let active=true,zero:Zero<typeof syncSchema,undefined,{id:string}>|undefined,cleanupView:(()=>void)|undefined,cleanupState:(()=>void)|undefined,refreshing=false;
  async function token(){const r=await fetch('/api/sync/token',{method:'POST',cache:'no-store'});if(r.status===401){window.location.replace('/?session=expired');throw Error('Session ended');}if(!r.ok)throw Error('Authentication unavailable');const value=await r.json();if(value.id!==userId){window.location.replace('/workspace');throw Error('Identity changed');}return value.token as string;}
  const invalidate=()=>{if(active){setRevision(n=>n+1);window.dispatchEvent(new Event('unischedule:invalidate'));}};
  async function connect(){
   if(!cacheURL)return;
   try{const auth=await token();if(!active)return;zero=new Zero({schema:syncSchema,userID:userId,context:{id:userId},auth,cacheURL,kvStore:'mem',logLevel:'error'});
    cleanupState=zero.connection.state.subscribe(s=>{if(!active)return;if(s.name!=='connected'){setReady(false);setState(s.name==='needs-auth'?'Rechecking your session…':'Updates disconnected. Reconnecting…');}
      if(s.name==='needs-auth'&&!refreshing){refreshing=true;void token().then(auth=>zero?.connection.connect({auth})).catch(()=>{if(active){setReady(false);setState('Unable to verify your session. Retry to reconnect.');}}).finally(()=>{refreshing=false;});}
      if(s.name==='connected'){invalidate();setReady(true);setState('Updates connected');}
    });
    const view=zero.materialize(syncQueries.mine());cleanupView=view.addListener((_data,type)=>{if(!active)return;if(type==='error'){setReady(false);setState('Updates failed. Retry to reconnect.');}else if(type==='complete')invalidate();});
   }catch{if(active){setReady(false);setState('Updates unavailable. Retry to reconnect.');}}
  }
  void connect();
  // Time-based expiry has no database write. Revalidate while online, including expiry and session changes.
  const timer=window.setInterval(invalidate,5000);
  const offline=()=>{setReady(false);setState('Offline. Protected content is hidden until reconnection.');};
  const online=()=>{if(cacheURL){setAttempt(n=>n+1);}else{setReady(true);invalidate();}};
  window.addEventListener('offline',offline);window.addEventListener('online',online);
  return()=>{active=false;clearInterval(timer);window.removeEventListener('offline',offline);window.removeEventListener('online',online);cleanupView?.();cleanupState?.();void zero?.close();};
 },[cacheURL,userId,attempt]);
 return <SyncRevision.Provider value={revision}><div className="sync-status" role="status" translate="no">{state}{!ready&&<button className="work-link" onClick={()=>setAttempt(n=>n+1)}>Retry connection</button>}</div>{ready&&children}</SyncRevision.Provider>;
}
