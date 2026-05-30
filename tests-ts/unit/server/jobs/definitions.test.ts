import { describe, expect, it } from "vitest";

import { parseJobPayload } from "../../../../src/server/jobs/definitions.ts";

describe("job payload definitions", () => {
  it("accepts known pg-boss payloads", () => {
    expect(parseJobPayload("generate_xlsx_export", { createdBy: "dev-user" })).toEqual({
      createdBy: "dev-user",
    });
    expect(parseJobPayload("backfill_rule", { ruleId: 7 })).toEqual({ ruleId: 7 });
    expect(parseJobPayload("sync_abn_transactions", {})).toEqual({});
  });

  it("rejects malformed payloads before jobs run", () => {
    expect(() => parseJobPayload("backfill_rule", { ruleId: "7" })).toThrow();
    expect(() => parseJobPayload("generate_xlsx_export", { runId: "1" })).toThrow();
  });
});
