import { describe, it, expect } from "vitest";
import { escapeHtml } from "../src/escape-html.js";

describe("escapeHtml", () => {
  it("escapes < and >", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert('xss')&lt;/script&gt;",
    );
  });

  it("escapes &", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('name="test"')).toBe("name=&quot;test&quot;");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("returns safe strings unchanged", () => {
    expect(escapeHtml("My Realm")).toBe("My Realm");
  });

  it("escapes all special characters together", () => {
    expect(escapeHtml('<a href="x">&')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });
});