import { authRequest, getAuth } from "@/server/auth/auth";
export const runtime = "nodejs";
async function handler(request: Request) {
  try { return await authRequest(getAuth(), request); }
  catch { return Response.json({ message: "Authentication is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
export { handler as GET, handler as POST };
