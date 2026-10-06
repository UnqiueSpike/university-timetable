import {getAuth} from "@/server/auth/auth";
import {syncToken} from "@/server/sync/auth";
export async function POST(request:Request){const auth=getAuth(),context=await auth.$context;if(request.headers.get("origin")!==new URL(context.baseURL).origin)return new Response(null,{status:403});const current=await auth.api.getSession({headers:request.headers,query:{disableCookieCache:true}});if(!current)return new Response(null,{status:401});return Response.json({id:current.user.id,token:syncToken(current.user.id,current.session.id,context.secret)},{headers:{"Cache-Control":"no-store"}});}
