import { Router } from "express";

export const healthRoutes = Router();
healthRoutes.get("/live", (req, res) => {
  res.json({ status: "ok" });
});

healthRoutes.get("/ready", async (req, res) => {
  try {
    await req.app.locals.database.query("SELECT 1");
    res.json({ status: "ready", database: "connected" });
  } catch {
    res.status(503).json({ status: "not_ready", database: "unavailable" });
  }
});
