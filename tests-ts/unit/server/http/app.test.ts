import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../../../src/server/http/app.ts";

describe("createApp", () => {
  it("exposes a public health route", async () => {
    const response = await request(createApp()).get("/healthz").expect(200);

    expect(response.body).toEqual({ status: "ok" });
  });
});
