import type { RequestHandler } from "express";

export const getTest: RequestHandler = (req, res) => {
  res.json({ success: true, data: { message: "PikaAI backend is running" } });
};

export const echoTest: RequestHandler = (req, res) => {
  const message: unknown = req.body?.message;
  if (typeof message !== "string" || !message.trim() || message.length > 500) {
    return res.status(400).json({
      success: false,
      error: { message: "message must be a non-empty string of at most 500 characters", requestId: req.id },
    });
  }
  res.json({ success: true, data: { message: message.trim() } });
};

export const getDatabaseTest: RequestHandler = async (req, res) => {
  try {
    const { rows } = await req.app.locals.database.query("SELECT NOW() AS timestamp");
    res.json({ success: true, data: { database: "connected", timestamp: rows[0]?.timestamp } });
  } catch (error) {
    console.error({ requestId: req.id, error });
    res.status(503).json({
      success: false,
      error: { message: "Database unavailable", requestId: req.id },
    });
  }
};
