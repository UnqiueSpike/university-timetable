import "server-only";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import type { Context } from "./trpc";
export function trpcRequest(request: Request, dependencies: Pick<Context, "db" | "auth">) {
  return fetchRequestHandler({ endpoint: "/api/trpc", req: request, router: appRouter,
    createContext: () => ({ ...dependencies, headers: request.headers, requestId: crypto.randomUUID() }),
    responseMeta: () => ({ headers: { "Cache-Control": "no-store" } }),
  });
}
