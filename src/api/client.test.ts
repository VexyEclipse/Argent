import { afterEach, describe, expect, it, vi } from "vitest";
import { randomId } from "./client";

describe("randomId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is 32 hex characters, and different each time", () => {
    expect(randomId()).toMatch(/^[0-9a-f]{32}$/);
    expect(randomId()).not.toBe(randomId());
  });

  it("works on plain-http pages, where crypto.randomUUID doesn't exist", () => {
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(randomId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
