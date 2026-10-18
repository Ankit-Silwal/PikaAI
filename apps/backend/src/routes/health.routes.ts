import { Router } from "express";

export const healthRoutes = Router();
healthRoutes.get("/live", (req, res) => {
  res.json({ status: "ok" });
});

healthRoutes.get("/ready", async (req, res) => {
  const [database, redis] = await Promise.allSettled([
    req.app.locals.prisma.$queryRaw`SELECT 1`, req.app.locals.authState.ping(),
  ]);
  const ready = database.status === "fulfilled" && redis.status === "fulfilled";
  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    database: database.status === "fulfilled" ? "connected" : "unavailable",
    redis: redis.status === "fulfilled" ? "connected" : "unavailable",
  });
});
