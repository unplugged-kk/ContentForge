/**
 * Local stand-in for an Auth0 tenant. TEST INFRASTRUCTURE, never imported by
 * the app. It speaks the endpoints @auth0/auth0-react and the server use:
 * /authorize (a login page instead of Universal Login), /oauth/token with a
 * real PKCE S256 check, /.well-known/jwks.json, /userinfo and /v2/logout.
 *
 * It enforces the same allow-lists the Auth0 dashboard does: exactly one
 * callback URL and one logout URL, so a wrong redirect fails here too.
 */
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { exportJWK, generateKeyPair, jwtVerify, createLocalJWKSet, SignJWT } from "jose";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function startAuth0Mock({ port, clientId, audience, callbackUrl, logoutUrl }) {
  const issuer = `http://127.0.0.1:${port}/`;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "mock-1", alg: "RS256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const codes = new Map();
  const users = new Map();
  const events = { authorize: [], token: [], userinfo: 0, logout: [] };

  async function mint(claims, { key = privateKey, kid = "mock-1", expiresIn = "10m" } = {}) {
    const { iss = issuer, aud = [audience, `${issuer}userinfo`], ...rest } = claims;
    return new SignJWT(rest)
      .setProtectedHeader({ alg: "RS256", kid, typ: "JWT" })
      .setIssuer(iss)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(key);
  }

  const readBody = (req) =>
    new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const type = req.headers["content-type"] ?? "";
        resolve(type.includes("json") ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw)));
      });
    });

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", ...headers });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    if (req.method === "OPTIONS") return send(res, 204, "");

    if (url.pathname === "/.well-known/jwks.json") return send(res, 200, { keys: [jwk] });

    if (url.pathname === "/authorize") {
      const p = Object.fromEntries(url.searchParams);
      events.authorize.push(p);
      if (p.client_id !== clientId || p.redirect_uri !== callbackUrl) {
        return send(res, 400, "Callback URL mismatch", { "content-type": "text/plain" });
      }
      if (p.prompt === "none") {
        // Silent authentication: there is no mock SSO cookie, so answer the
        // iframe the way Auth0 does when the user must log in.
        const origin = new URL(p.redirect_uri).origin;
        const msg = { type: "authorization_response", response: { error: "login_required", state: p.state } };
        return send(
          res,
          200,
          `<script>parent.postMessage(${JSON.stringify(msg)}, ${JSON.stringify(origin)});</script>`,
          { "content-type": "text/html" },
        );
      }
      const hidden = Object.entries(p)
        .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
        .join("");
      return send(
        res,
        200,
        `<!doctype html><title>Mock Universal Login</title><h1>Mock Universal Login</h1>
<form method="post" action="/authorize/complete">${hidden}
<label>Subject <input name="mock_sub" value="google-oauth2|mock"></label>
<label>Email <input name="mock_email" value="person@example.test"></label>
<label><input type="checkbox" name="mock_email_verified" value="1" checked> Email verified</label>
<button type="submit">Continue</button></form>`,
        { "content-type": "text/html" },
      );
    }

    if (url.pathname === "/authorize/complete" && req.method === "POST") {
      const p = await readBody(req);
      const code = b64url(randomBytes(24));
      codes.set(code, {
        challenge: p.code_challenge,
        method: p.code_challenge_method,
        nonce: p.nonce,
        redirectUri: p.redirect_uri,
        audience: p.audience,
        scope: p.scope,
        sub: p.mock_sub,
        email: p.mock_email || null,
        emailVerified: p.mock_email_verified === "1",
      });
      const back = new URL(p.redirect_uri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", p.state);
      return send(res, 302, "", { location: back.toString() });
    }

    if (url.pathname === "/oauth/token" && req.method === "POST") {
      const p = await readBody(req);
      const grant = codes.get(p.code);
      codes.delete(p.code);
      const verifierHash = p.code_verifier ? b64url(createHash("sha256").update(p.code_verifier).digest()) : "";
      const pkceOk = grant && grant.method === "S256" && verifierHash === grant.challenge;
      events.token.push({ pkceOk: Boolean(pkceOk), clientSecretSent: "client_secret" in p });
      if (!grant || !pkceOk || p.client_id !== clientId || p.redirect_uri !== grant.redirectUri) {
        return send(res, 403, { error: "invalid_grant", error_description: "PKCE or code check failed" });
      }
      const access_token = await mint({ sub: grant.sub, azp: clientId, scope: grant.scope, aud: [grant.audience, `${issuer}userinfo`] });
      const id_token = await mint({
        sub: grant.sub,
        aud: clientId,
        nonce: grant.nonce,
        email: grant.email,
        email_verified: grant.emailVerified,
        name: "Mock Person",
      });
      users.set(grant.sub, { email: grant.email, email_verified: grant.emailVerified, name: "Mock Person" });
      return send(res, 200, { access_token, id_token, token_type: "Bearer", expires_in: 600, scope: grant.scope });
    }

    if (url.pathname === "/userinfo") {
      events.userinfo += 1;
      try {
        const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        const { payload } = await jwtVerify(token, keys, { issuer, audience: `${issuer}userinfo` });
        return send(res, 200, { sub: payload.sub, ...(users.get(payload.sub) ?? {}) });
      } catch {
        return send(res, 401, { error: "invalid_token" });
      }
    }

    if (url.pathname === "/v2/logout") {
      events.logout.push(Object.fromEntries(url.searchParams));
      const returnTo = url.searchParams.get("returnTo");
      if (url.searchParams.get("client_id") !== clientId || returnTo !== logoutUrl) {
        return send(res, 400, "Logout URL mismatch", { "content-type": "text/plain" });
      }
      return send(res, 302, "", { location: returnTo });
    }

    send(res, 404, { error: "not_found" });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    issuer,
    events,
    mint,
    /** Registers what /userinfo reports for a subject minted directly by a test. */
    setUser: (sub, profile) => users.set(sub, profile),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
