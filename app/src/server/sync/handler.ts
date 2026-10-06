import "server-only";
import {mustGetQuery} from "@rocicorp/zero";
import {handleQueryRequest} from "@rocicorp/zero/server";
import type {Database} from "../db/connection";
import {syncSchema,syncQueries} from "../../lib/sync/schema";
import {syncIdentity} from "./auth";
export async function syncRequest(request:Request,db:Database,secret:string){
 const identity=await syncIdentity(db,(request.headers.get("authorization")??'').replace(/^Bearer /,''),secret);
 if(!identity)return new Response("Unauthenticated",{status:401,headers:{"Cache-Control":"no-store"}});
 try{const result=await handleQueryRequest({request,schema:syncSchema,userID:identity.id,handler:(name,args)=>mustGetQuery(syncQueries,name).fn({args,ctx:identity})});return Response.json(result,{headers:{"Cache-Control":"no-store"}});}catch{return new Response("Query unavailable",{status:400});}
}
