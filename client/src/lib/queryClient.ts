import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getCsrfToken, invalidateCsrfToken } from "./csrf";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

function buildHeaders(data: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  return headers;
}

/**
 * Single apiRequest used by both queries and mutations. Adds X-CSRF-Token
 * header when available; the server only verifies it on state-changing
 * methods, so including it on GETs is harmless and keeps the client simple.
 *
 * On 403 with "Invalid or missing CSRF token" we invalidate the cached token,
 * refetch once, and retry. After that we surface the error.
 */
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const csrfToken = await getCsrfToken();
  const headers = buildHeaders(data);
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;

  let res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  if (res.status === 403 && csrfToken) {
    const body = await res.clone().text().catch(() => "");
    if (body.includes("CSRF")) {
      invalidateCsrfToken();
      const fresh = await getCsrfToken();
      if (fresh) {
        headers["X-CSRF-Token"] = fresh;
        res = await fetch(url, {
          method,
          headers,
          body: data ? JSON.stringify(data) : undefined,
          credentials: "include",
        });
      }
    }
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
