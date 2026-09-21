import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  assertYouTubeCertificationPublish,
  publishCertificationMode,
  readPublishCertificationBudget,
  realPublishAllowed,
  recordYouTubeCertificationPublish,
  YOUTUBE_PUBLISH_CERT_KEY,
} from "./publishCertification";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "cf-pub-cert-"));
  dirs.push(dir);
  return {
    CONTENTFORGE_REAL_PUBLISH_E2E: "1",
    CONTENTFORGE_PUBLISH_CERTIFICATION: "1",
    PUBLISH_CERT_BUDGET_PATH: join(dir, "budget.json"),
    ...extra,
  };
}

describe("publish certification budget", () => {
  it("blocks real publish without flags", () => {
    assert.equal(realPublishAllowed({}), false);
    assert.equal(publishCertificationMode({}), false);
  });

  it("enforces private/unlisted and one-shot budget in cert mode", () => {
    const e = env();
    assert.throws(
      () => assertYouTubeCertificationPublish({ privacyStatus: "public", certKey: YOUTUBE_PUBLISH_CERT_KEY }, e),
      /private or unlisted/,
    );
    assert.doesNotThrow(() => assertYouTubeCertificationPublish({
      privacyStatus: "private",
      certKey: YOUTUBE_PUBLISH_CERT_KEY,
    }, e));
    recordYouTubeCertificationPublish(YOUTUBE_PUBLISH_CERT_KEY, e);
    assert.equal(readPublishCertificationBudget(e).youtubePublishes, 1);
    assert.throws(
      () => assertYouTubeCertificationPublish({
        privacyStatus: "unlisted",
        certKey: YOUTUBE_PUBLISH_CERT_KEY,
      }, e),
      /budget exhausted|already consumed/,
    );
  });
});
