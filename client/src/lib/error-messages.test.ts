import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toUserMessage } from "./error-messages";

describe("toUserMessage", () => {
  it("maps 401 to a session-expired message", () => {
    const { title } = toUserMessage(new Error('401: {"message":"Invalid email or password"}'));
    assert.equal(title, "Session expired");
  });

  it("maps 403 to a permission message", () => {
    const { title } = toUserMessage(new Error("403: Invalid or missing CSRF token"));
    assert.equal(title, "Not allowed");
  });

  it("maps 5xx to a generic retry message without leaking JSON", () => {
    const { title, description } = toUserMessage(
      new Error('500: {"message":"Failed to generate content. Please try again."}'),
    );
    assert.equal(title, "Something went wrong");
    assert.ok(!description.includes("{"));
  });

  it("surfaces the server's plain-language message for 4xx bodies", () => {
    const { description } = toUserMessage(
      new Error('400: {"message":"Could not fetch URL. Try pasting the content instead."}'),
    );
    assert.equal(description, "Could not fetch URL. Try pasting the content instead.");
  });

  it("falls back for non-HTTP errors", () => {
    const { title } = toUserMessage(new Error("network offline"));
    assert.equal(title, "Something went wrong");
  });
});
