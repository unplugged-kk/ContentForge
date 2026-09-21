import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createJobScopedLogger, redact } from "./logger";

describe("secret redaction", () => {
  it("redacts credential-shaped keys at the top level", () => {
    const out = redact({
      accessToken: "abc",
      apiKey: "xyz",
      password: "p",
      SESSION_SECRET: "s",
      cookie: "c",
      authorization: "Bearer t",
      provider: "rss",
    }) as Record<string, unknown>;

    assert.equal(out.accessToken, "[redacted]");
    assert.equal(out.apiKey, "[redacted]");
    assert.equal(out.password, "[redacted]");
    assert.equal(out.SESSION_SECRET, "[redacted]");
    assert.equal(out.cookie, "[redacted]");
    assert.equal(out.authorization, "[redacted]");
    assert.equal(out.provider, "rss", "non-secret fields pass through");
  });

  it("redacts nested keys", () => {
    const out = redact({ a: { b: { refreshToken: "t", keep: 1 } } }) as any;
    assert.equal(out.a.b.refreshToken, "[redacted]");
    assert.equal(out.a.b.keep, 1);
  });

  it("redacts keys inside arrays", () => {
    const out = redact([{ token: "t" }, { ok: true }]) as any[];
    assert.equal(out[0].token, "[redacted]");
    assert.equal(out[1].ok, true);
  });

  it("stops at a depth limit instead of recursing forever", () => {
    let deep: any = { leaf: 1 };
    for (let i = 0; i < 12; i++) deep = { next: deep };
    const out = JSON.stringify(redact(deep));
    assert.ok(out.includes("depth-limit"));
  });
});

describe("job logger", () => {
  it("emits single-line JSON carrying job identity", () => {
    const lines: string[] = [];
    const logger = createJobScopedLogger(
      { jobType: "research.run", jobId: "j1", correlationId: "c1", attempt: 2 },
      (line) => lines.push(line),
    );

    logger.info({ provider: "rss", resultCount: 3 }, "provider finished");

    assert.equal(lines.length, 1);
    assert.ok(!lines[0].includes("\n"), "single line");
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.jobType, "research.run");
    assert.equal(parsed.jobId, "j1");
    assert.equal(parsed.correlationId, "c1");
    assert.equal(parsed.attempt, 2);
    assert.equal(parsed.provider, "rss");
    assert.equal(parsed.resultCount, 3);
    assert.equal(parsed.msg, "provider finished");
  });

  it("never writes a secret that a handler passes by mistake", () => {
    const lines: string[] = [];
    const logger = createJobScopedLogger(
      { jobType: "t", jobId: "j", correlationId: "c", attempt: 1 },
      (line) => lines.push(line),
    );

    logger.error({ accessToken: "super-secret", ok: false }, "failed");

    assert.ok(!lines[0].includes("super-secret"));
    assert.equal(JSON.parse(lines[0]).accessToken, "[redacted]");
  });
});
