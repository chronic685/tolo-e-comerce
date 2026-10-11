import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import type { TokenSource } from "./token";

export type ToloClient = ReturnType<typeof createClient<paths>>;

export interface ClientOptions {
  baseUrl: string;
  getToken: TokenSource;
  /** For tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/** The typed client for the Tolo API. Adds "Authorization: Bearer <token>" when there is a token and sends nothing otherwise (anonymous browsing). */
export function createToloClient({ baseUrl, getToken, fetch }: ClientOptions): ToloClient {
  const client = createClient<paths>({ baseUrl: baseUrl.replace(/\/+$/, ""), ...(fetch ? { fetch } : {}) });
  const auth: Middleware = {
    onRequest({ request }) {
      const token = getToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return request;
    },
  };
  client.use(auth);
  return client;
}
