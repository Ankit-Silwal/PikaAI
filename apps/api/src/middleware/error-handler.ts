import type { ErrorRequestHandler } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "../utils/http-error.js";

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    res.status(409).json({ error: "Email already registered" });
  } else if (error instanceof SyntaxError && "status" in error && error.status === 400) {
    res.status(400).json({ error: "Invalid JSON" });
  } else {
    console.error("Request failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
