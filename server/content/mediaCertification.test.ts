import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  assertElevenLabsCertificationRequest,
  assertFalCertificationRequest,
  assertPaidMediaAllowed,
  ELEVENLABS_CERT_KEY,
  FAL_CERT_KEY,
  mediaCertificationMode,
  paidMediaCallsAllowed,
  readMediaCertificationBudget,
  recordElevenLabsCertificationCall,
  recordFalCertificationCall,
} from "./mediaCertification";

const scratchDirs: string[] = [];

function certEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "cf-media-cert-"));
  scratchDirs.push(dir);
  return {
    CONTENTFORGE_REAL_MEDIA_E2E: "1",
    CONTENTFORGE_MEDIA_CERTIFICATION: "1",
    MEDIA_CERT_BUDGET_PATH: join(dir, "budget.json"),
    ...extra,
  };
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("media certification budget", () => {
  it("blocks paid calls without explicit certification flags", () => {
    assert.equal(paidMediaCallsAllowed({}), false);
    assert.equal(mediaCertificationMode({}), false);
    assert.throws(
      () => assertPaidMediaAllowed("elevenlabs", {}),
      /blocked without/,
    );
  });

  it("allows paid escape hatch without counting certification budget", () => {
    const env = {
      CONTENTFORGE_ALLOW_PAID_MEDIA: "1",
      MEDIA_CERT_BUDGET_PATH: join(mkdtempSync(join(tmpdir(), "cf-allow-")), "budget.json"),
    };
    scratchDirs.push(env.MEDIA_CERT_BUDGET_PATH.replace(/\/budget\.json$/, ""));
    assert.equal(paidMediaCallsAllowed(env), true);
    assert.equal(mediaCertificationMode(env), false);
    assert.doesNotThrow(() => assertElevenLabsCertificationRequest({
      text: "x".repeat(500),
      certKey: ELEVENLABS_CERT_KEY,
    }, env));
    recordElevenLabsCertificationCall(ELEVENLABS_CERT_KEY, env);
    assert.equal(readMediaCertificationBudget(env).elevenlabsCalls, 0);
  });

  it("enforces ElevenLabs certification text/budget/idempotency key", () => {
    const env = certEnv();
    assert.throws(
      () => assertElevenLabsCertificationRequest({
        text: "x".repeat(201),
        certKey: ELEVENLABS_CERT_KEY,
      }, env),
      /exceeds 200/,
    );
    assert.doesNotThrow(() => assertElevenLabsCertificationRequest({
      text: "short certification text",
      certKey: ELEVENLABS_CERT_KEY,
    }, env));
    recordElevenLabsCertificationCall(ELEVENLABS_CERT_KEY, env);
    assert.equal(readMediaCertificationBudget(env).elevenlabsCalls, 1);
    assert.throws(
      () => assertElevenLabsCertificationRequest({
        text: "another",
        certKey: ELEVENLABS_CERT_KEY,
      }, env),
      /budget exhausted|already consumed/,
    );
  });

  it("enforces fal certification resolution/duration/budget", () => {
    const env = certEnv();
    assert.throws(
      () => assertFalCertificationRequest({
        resolution: "720p",
        numFrames: 17,
        framesPerSecond: 16,
        certKey: FAL_CERT_KEY,
      }, env),
      /480p/,
    );
    assert.throws(
      () => assertFalCertificationRequest({
        resolution: "480p",
        numFrames: 48,
        framesPerSecond: 16,
        certKey: FAL_CERT_KEY,
      }, env),
      /exceeds 2000ms/,
    );
    assert.doesNotThrow(() => assertFalCertificationRequest({
      resolution: "480p",
      numFrames: 17,
      framesPerSecond: 16,
      certKey: FAL_CERT_KEY,
    }, env));
    recordFalCertificationCall(FAL_CERT_KEY, env);
    assert.throws(
      () => assertFalCertificationRequest({
        resolution: "480p",
        numFrames: 17,
        framesPerSecond: 16,
        certKey: FAL_CERT_KEY,
      }, env),
      /budget exhausted|already consumed/,
    );
  });

  it("forbids regenerate under certification mode", () => {
    const env = certEnv();
    assert.throws(
      () => assertElevenLabsCertificationRequest({
        text: "ok",
        regenerate: true,
        certKey: ELEVENLABS_CERT_KEY,
      }, env),
      /forbids regenerate/,
    );
    assert.throws(
      () => assertFalCertificationRequest({
        resolution: "480p",
        regenerate: true,
        certKey: FAL_CERT_KEY,
      }, env),
      /forbids regenerate/,
    );
  });
});
