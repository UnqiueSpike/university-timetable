import {getAuth} from "@/server/auth/auth";
import {getDatabase} from "@/server/db/connection";
import {syncRequest} from "@/server/sync/handler";
export const runtime="nodejs";
export async function POST(request:Request){return syncRequest(request,getDatabase(),(await getAuth().$context).secret);}
