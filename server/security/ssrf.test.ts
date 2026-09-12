import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  UnsafeUrlError,
  createGuardedLookup,
  isBlockedAddress,
  safeFetch,
  validateUrlSyntax,
} from "./ssrf";

describe("isBlockedAddress", () => {
  it("blocks loopback", () => {
    assert.equal(isBlockedAddress("127.0.0.1"), true);
    assert.equal(isBlockedAddress("127.9.9.9"), true);
    assert.equal(isBlockedAddress("::1"), true);
    assert.equal(isBlockedAddress("::"), true);
  });

  it("blocks private ranges", () => {
    assert.equal(isBlockedAddress("10.0.0.1"), true);
    assert.equal(isBlockedAddress("172.16.0.1"), true);
    assert.equal(isBlockedAddress("172.31.255.254"), true);
    assert.equal(isBlockedAddress("192.168.1.1"), true);
    assert.equal(isBlockedAddress("fc00::1"), true);
    assert.equal(isBlockedAddress("fd12:3456::1"), true);
  });

  it("blocks link-local and the cloud metadata endpoint", () => {
    assert.equal(isBlockedAddress("169.254.169.254"), true);
    assert.equal(isBlockedAddress("169.254.0.1"), true);
    assert.equal(isBlockedAddress("fe80::1"), true);
  });

  it("blocks CGNAT, multicast, and reserved space", () => {
    assert.equal(isBlockedAddress("100.64.0.1"), true);
    assert.equal(isBlockedAddress("224.0.0.1"), true);
    assert.equal(isBlockedAddress("240.0.0.1"), true);
    assert.equal(isBlockedAddress("255.255.255.255"), true);
    assert.equal(isBlockedAddress("ff02::1"), true);
  });

  it("blocks IPv4-mapped IPv6 pointing at private space", () => {
    assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true);
    assert.equal(isBlockedAddress("::ffff:169.254.169.254"), true);
    assert.equal(isBlockedAddress("::ffff:10.0.0.5"), true);
  });

  it("allows routable public addresses", () => {
    assert.equal(isBlockedAddress("8.8.8.8"), false);
    assert.equal(isBlockedAddress("1.1.1.1"), false);
    assert.equal(isBlockedAddress("93.184.216.34"), false);
    assert.equal(isBlockedAddress("172.32.0.1"), false, "just outside 172.16/12");
    assert.equal(isBlockedAddress("2001:4860:4860::8888"), false);
    assert.equal(isBlockedAddress("::ffff:8.8.8.8"), false);
  });

  it("treats non-IP input as blocked", () => {
    assert.equal(isBlockedAddress("example.com"), true);
    assert.equal(isBlockedAddress(""), true);
  });
});

describe("validateUrlSyntax", () => {
  it("accepts ordinary public http(s) URLs", () => {
    assert.equal(validateUrlSyntax("https://example.com/a?b=1").hostname, "example.com");
    assert.equal(validateUrlSyntax("http://example.com/").protocol, "http:");
  });

  it("rejects non-http protocols", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/x",
      "gopher://example.com/",
      "data:text/html,hi",
    ]) {
      assert.throws(() => validateUrlSyntax(url), UnsafeUrlError, url);
    }
  });

  it("rejects embedded credentials", () => {
    assert.throws(
      () => validateUrlSyntax("https://user:pass@example.com/"),
      /credentials/,
    );
  });

  it("rejects disallowed ports", () => {
    assert.throws(() => validateUrlSyntax("http://example.com:8080/"), /not allowed/);
    assert.throws(() => validateUrlSyntax("http://example.com:22/"), /not allowed/);
  });

  it("rejects literal private/metadata addresses", () => {
    assert.throws(() => validateUrlSyntax("http://169.254.169.254/latest/meta-data/"), /not routable/);
    assert.throws(() => validateUrlSyntax("http://127.0.0.1/"), /not routable/);
    assert.throws(() => validateUrlSyntax("http://[::1]/"), /not routable/);
  });

  it("rejects garbage", () => {
    assert.throws(() => validateUrlSyntax("not a url"), UnsafeUrlError);
  });
});

describe("createGuardedLookup", () => {
  it("rejects a hostname that resolves to a blocked address", async () => {
    const lookup = createGuardedLookup();
    await new Promise<void>((resolve) => {
      lookup("localhost", { all: true }, (err) => {
        assert.ok(err instanceof UnsafeUrlError, `expected UnsafeUrlError, got ${err}`);
        assert.equal((err as UnsafeUrlError).reason, "blocked_address");
        resolve();
      });
    });
  });
});

describe("safeFetch", () => {
  let server: http.Server;
  let port: number;

  // Injected resolver: the real guard is proven above; this lets the request
  // machinery (redirects, size cap, timeouts) be exercised deterministically.
  const localLookup = (
    _hostname: string,
    options: { all?: boolean },
    callback: (err: Error | null, address?: unknown, family?: number) => void,
  ) => {
    if (options?.all) return callback(null, [{ address: "127.0.0.1", family: 4 }]);
    callback(null, "127.0.0.1", 4);
  };

  before(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      if (url === "/ok") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><title>Hello</title><body>research me</body></html>");
        return;
      }
      if (url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("x".repeat(200_000));
        return;
      }
      if (url === "/redirect") {
        res.writeHead(302, { location: "/ok" });
        res.end();
        return;
      }
      if (url === "/redirect-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
        return;
      }
      if (url === "/loop") {
        res.writeHead(302, { location: "/loop" });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end("nope");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const base = () => `http://example.test:${port}`;
  const opts = () => ({ lookup: localLookup, allowedPorts: [port] });

  it("fetches an allowed public URL", async () => {
    const res = await safeFetch(`${base()}/ok`, opts());
    assert.equal(res.status, 200);
    assert.ok(res.body.includes("research me"));
    assert.equal(res.truncated, false);
  });

  it("truncates a response beyond the byte ceiling", async () => {
    const res = await safeFetch(`${base()}/big`, { ...opts(), maxBytes: 1000 });
    assert.equal(res.truncated, true);
    assert.ok(res.body.length <= 200_000);
  });

  it("follows a redirect to an allowed target", async () => {
    const res = await safeFetch(`${base()}/redirect`, opts());
    assert.equal(res.status, 200);
    assert.ok(res.body.includes("research me"));
    assert.ok(res.finalUrl.endsWith("/ok"));
  });

  it("refuses a redirect into the metadata endpoint", async () => {
    await assert.rejects(
      // Allow port 80 as well, so the *address* guard is what rejects the hop.
      () => safeFetch(`${base()}/redirect-metadata`, { ...opts(), allowedPorts: [port, 80] }),
      (error: unknown) => {
        assert.ok(error instanceof UnsafeUrlError);
        assert.equal(error.reason, "blocked_address");
        return true;
      },
    );
  });

  it("stops after the redirect ceiling", async () => {
    await assert.rejects(
      () => safeFetch(`${base()}/loop`, { ...opts(), maxRedirects: 2 }),
      /redirect/i,
    );
  });

  it("rejects a blocked scheme before connecting", async () => {
    await assert.rejects(() => safeFetch("file:///etc/passwd", opts()), /http and https/);
  });

  it("rejects a blocked host under the default resolver", async () => {
    await assert.rejects(() => safeFetch("http://localhost/", { allowedPorts: [80] }), UnsafeUrlError);
  });

  it("enforces the timeout", async () => {
    const slow = http.createServer((_req, _res) => {
      /* never responds */
    });
    await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
    const slowPort = (slow.address() as AddressInfo).port;
    try {
      await assert.rejects(
        () =>
          safeFetch(`http://example.test:${slowPort}/`, {
            lookup: localLookup,
            allowedPorts: [slowPort],
            timeoutMs: 300,
          }),
        /timed out|deadline/i,
      );
    } finally {
      await new Promise<void>((resolve) => slow.close(() => resolve()));
    }
  });
});
