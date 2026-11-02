import { describe, expect, test } from "bun:test";

import { authProviderLabel } from "./presentation";

describe("authProviderLabel", () => {
  test("distinguishes a completed no-match from a pending check", () => {
    expect(authProviderLabel({ provider: null }, "completed")).toBe(
      "No provider found",
    );
    expect(authProviderLabel(undefined, "pending")).toBe("Checking…");
  });
});
