import { describe, expect, it } from "vitest";

import { describeRuntime } from "../../../src/shared/version.ts";

describe("describeRuntime", () => {
  it("includes the app name and node version", () => {
    expect(describeRuntime("24.13.0")).toBe("treasuri node/24.13.0");
  });
});
