import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
import { getPrincipal, type Permission } from "./authorization";
import { getDatabase } from "../db/connection";
export async function pagePrincipal(permission?: Permission) {
  const requestHeaders = await headers();
  const current = await getAuth().api.getSession({ headers: requestHeaders, query: { disableCookieCache: true } });
  if (!current) redirect("/?session=expired");
  const principal = await getPrincipal(getDatabase(), current.user);
  if (permission && !principal.grants.some(g => g.permission === permission)) redirect("/workspace");
  return principal;
}
