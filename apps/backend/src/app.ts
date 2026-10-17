import type { Health } from "@tka/shared";
import { Hono } from "hono";
import { AIError } from "./ai/client";
import { HttpError } from "./http";
import issues from "./routes/issues";
import meta from "./routes/meta";
import projects from "./routes/projects";

// ルートはチェーンで繋ぐ（AppType がフロントの hc<AppType> に型を渡す）
const app = new Hono()
  .basePath("/api")
  .onError((e, c) => {
    if (e instanceof AIError) return c.json({ detail: e.message }, 502);
    if (e instanceof HttpError) return c.json({ detail: e.message }, e.status);
    console.error(e);
    return c.json({ detail: "サーバーでエラーが起きました" }, 500);
  })
  .get("/health", (c) => {
    const body: Health = { status: "ok" };
    return c.json(body);
  })
  .route("/", meta)
  .route("/projects", projects)
  .route("/projects", issues);

export type AppType = typeof app;
export default app;
