import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildVideoFactoryJobRequest } from "./videoFactoryContract";
import {
  compositionDurationMs,
  escapeHtmlText,
  renderVideoFactoryCompositionHtml,
} from "./videoFactoryComposition";

describe("video factory composition adapter", () => {
  it("treats title and script as escaped data, never raw HTML", () => {
    const request = buildVideoFactoryJobRequest({
      generationId: 3,
      snapshot: {
        intent: {
          title: `<script>alert(1)</script>`,
          brief: `ok <img src=x onerror=alert(1)>`,
          script: `Hello</p><script src="https://evil">`,
          aspectRatio: "9:16",
          durationMs: 3000,
        },
      },
    });
    const html = renderVideoFactoryCompositionHtml(request);
    assert.equal(html.includes("<script>alert(1)</script>"), false);
    assert.equal(html.includes(`onerror=alert(1)`), false);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /data-composition-id="root"/);
    assert.match(html, /data-width="1080"/);
    assert.match(html, /data-height="1920"/);
    assert.equal(compositionDurationMs(request), 3000);
  });

  it("escapeHtmlText encodes markup characters", () => {
    assert.equal(escapeHtmlText(`a&b<"'>`), "a&amp;b&lt;&quot;&#39;&gt;");
  });
});
