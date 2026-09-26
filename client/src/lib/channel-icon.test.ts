import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelIcon } from "../components/ui-shared/channel-icon";

describe("ChannelIcon", () => {
  it("exposes an accessible name for an icon-only channel", () => {
    const markup = renderToStaticMarkup(createElement(ChannelIcon, { channel: "x" }));
    assert.match(markup, /role="img"/);
    assert.match(markup, /aria-label="X"/);
    assert.match(markup, /aria-hidden="true"/);
  });

  it("is decorative when visible channel text is adjacent", () => {
    const markup = renderToStaticMarkup(createElement(ChannelIcon, { channel: "threads", decorative: true }));
    assert.match(markup, /aria-hidden="true"/);
    assert.doesNotMatch(markup, /role="img"/);
    assert.doesNotMatch(markup, /aria-label=/);
  });

  it("names a combined X and Threads target", () => {
    const markup = renderToStaticMarkup(createElement(ChannelIcon, { channel: "both" }));
    assert.match(markup, /aria-label="X and Threads"/);
  });
});
