import { expect, test } from "bun:test";
import { healthSchema } from "@tka/shared";
import app from "../src/app";

test("GET /api/health returns ok", async () => {
  const res = await app.request("/api/health");
  expect(res.status).toBe(200);
  expect(healthSchema.parse(await res.json())).toEqual({ status: "ok" });
});
