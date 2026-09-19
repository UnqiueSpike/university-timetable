import { getAuth } from "@/server/auth/auth";
import { getDatabase } from "@/server/db/connection";
import { trpcRequest } from "@/server/api/handler";
export const runtime = "nodejs";
async function handler(request: Request) {
  try { return await trpcRequest(request, { db: getDatabase(), auth: getAuth() }); }
  catch { return Response.json({ error: { message: "Service temporarily unavailable", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 503 } } }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
export { handler as GET, handler as POST };
