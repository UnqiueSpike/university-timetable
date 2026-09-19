"use client";
import { useEffect, useState } from "react";
import {useSyncRevision} from "../auth/sync-provider";
import * as Dialog from "@radix-ui/react-dialog";
import { TRPCClientError } from "@trpc/client";
export function message(error:unknown) {
  if(error instanceof TRPCClientError) {
    if(error.data?.code==="UNAUTHORIZED") window.location.replace("/?session=expired");
    if(error.data?.code==="CONFLICT")return "This record changed. Reload it before saving again. Your unsaved text is kept below.";
    return error.message;
  }
  return "Unable to complete this request. Please try again.";
}
export function useRemote<T>(load:()=>Promise<T>, revision=0): {value?:T;error?:string} {
  const syncRevision=useSyncRevision();
  const [result,setResult]=useState<{load:typeof load;revision:number;value?:T;error?:string}>();
  useEffect(()=>{let active=true;load().then(value=>{if(active)setResult({load,revision,value});}).catch(error=>{if(active)setResult({load,revision,error:message(error)});});return()=>{active=false;};},[load,revision,syncRevision]);
  return result?.load===load&&result.revision===revision?result:{};
}
export async function allPages<T>(load:(cursor?:string)=>Promise<{items:T[];nextCursor:string|null}>) {const rows:T[]=[],seen=new Set<string>();let cursor:string|undefined;do{const p=await load(cursor);rows.push(...p.items);cursor=p.nextCursor??undefined;if(cursor){if(seen.has(cursor))throw new Error("Pagination did not advance");seen.add(cursor);}}while(cursor);return rows;}
export function Drawer({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) {return <Dialog.Root open onOpenChange={open=>{if(!open)close();}}><Dialog.Portal><Dialog.Overlay className="detail-overlay"/><Dialog.Content className="detail-drawer work-drawer"><Dialog.Title className="text-lg font-semibold pr-8">{title}</Dialog.Title><Dialog.Description className="sr-only">View details or edit permitted fields.</Dialog.Description><Dialog.Close aria-label="Close panel" className="detail-close">×</Dialog.Close>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;}
export function Notice({text}:{text:string}) {return <p role="alert" className="work-notice">{text}</p>;}
