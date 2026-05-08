import { Hono } from "hono";
import { Env } from "./types/env";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => {
  return c.json({ status: "ok", service: "vilcami", version: "0.1.0" });
});

app.get("/health", (c) => {
  return c.json({ status: "healthy", timestamp: new Date().toISOString() });
});

export default app;