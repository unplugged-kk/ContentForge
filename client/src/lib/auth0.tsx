import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn, queryClient } from "./queryClient";
import { invalidateCsrfToken } from "./csrf";

/**
 * Auth0 Universal Login for the SPA (Authorization Code + PKCE through
 * @auth0/auth0-react). Auth0 only authenticates: right after the redirect
 * back, the access token is exchanged once for the application's own session
 * cookie, and the app runs on that session like every other login.
 *
 * The domain, client id and audience are public and come from
 * /api/auth/config at runtime, so one bundle serves every environment.
 */
export const AUTH0_CALLBACK_PATH = "/auth/callback";

interface AuthConfig {
  googleEnabled: boolean;
  auth0: { domain: string; clientId: string; audience: string } | null;
}

interface Auth0Session {
  /** Why the last Universal Login round trip did not produce a session. */
  failure: string | null;
  login: () => Promise<void>;
  /** Ends the Auth0 SSO session and returns to the app's origin. */
  logout: () => Promise<void>;
}

const Auth0SessionContext = createContext<Auth0Session | null>(null);

/** Null when this instance has no Auth0 configuration. */
export function useAuth0Session(): Auth0Session | null {
  return useContext(Auth0SessionContext);
}

/** Only a same-origin path is a valid post-login destination. */
function safeReturnTo(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : "/";
}

async function exchangeForAppSession(accessToken: string): Promise<unknown> {
  const res = await fetch("/api/auth/auth0/session", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    credentials: "include",
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(body.message || "Sign-in failed. Try again.");
  return body;
}

function Auth0SessionBridge({ isCallback, children }: { isCallback: boolean; children: ReactNode }) {
  const auth0 = useAuth0();
  const [, navigate] = useLocation();
  const [failure, setFailure] = useState<string | null>(null);
  const exchanged = useRef(false);

  useEffect(() => {
    if (!isCallback || auth0.isLoading || exchanged.current) return;
    exchanged.current = true;

    if (auth0.error || !auth0.isAuthenticated) {
      if (auth0.error) setFailure(auth0.error.message || "Sign-in was cancelled.");
      navigate("/", { replace: true });
      return;
    }

    (async () => {
      const accessToken = await auth0.getAccessTokenSilently();
      if (!accessToken) throw new Error("Sign-in did not return an access token. Try again.");
      const user = await exchangeForAppSession(accessToken);
      // The session id changed, so any CSRF token from before login is stale.
      invalidateCsrfToken();
      queryClient.setQueryData(["/api/auth/me"], user);
      const returnTo = safeReturnTo(sessionStorage.getItem("cf.auth0.returnTo"));
      sessionStorage.removeItem("cf.auth0.returnTo");
      navigate(returnTo, { replace: true });
    })().catch((err: Error) => {
      setFailure(err.message);
      navigate("/", { replace: true });
    });
  }, [isCallback, auth0.isLoading, auth0.isAuthenticated, auth0.error]);

  const session: Auth0Session = {
    failure,
    login: async () => {
      setFailure(null);
      sessionStorage.setItem("cf.auth0.returnTo", window.location.pathname + window.location.search);
      await auth0.loginWithRedirect();
    },
    logout: () => auth0.logout({ logoutParams: { returnTo: window.location.origin } }),
  };

  return <Auth0SessionContext.Provider value={session}>{children}</Auth0SessionContext.Provider>;
}

/**
 * Children render at once; the provider wraps them when the config arrives
 * so the pre-auth paint never waits on it. The redirect callback is handled
 * only on AUTH0_CALLBACK_PATH, so other pages' query strings (OAuth returns
 * from YouTube and the like) are never mistaken for an Auth0 response.
 */
export function Auth0Boundary({ children }: { children: ReactNode }) {
  const { data: config, isFetched } = useQuery<AuthConfig | null>({
    queryKey: ["/api/auth/config"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });
  const [isCallback] = useState(() => window.location.pathname === AUTH0_CALLBACK_PATH);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (isCallback && isFetched && !config?.auth0) navigate("/", { replace: true });
  }, [isCallback, isFetched, config]);

  const auth0 = config?.auth0;
  if (!auth0) return <>{children}</>;

  return (
    <Auth0Provider
      domain={auth0.domain}
      clientId={auth0.clientId}
      authorizationParams={{
        redirect_uri: window.location.origin + AUTH0_CALLBACK_PATH,
        audience: auth0.audience,
        scope: "openid profile email",
      }}
      skipRedirectCallback={!isCallback}
      onRedirectCallback={() => {}}
    >
      <Auth0SessionBridge isCallback={isCallback}>{children}</Auth0SessionBridge>
    </Auth0Provider>
  );
}
