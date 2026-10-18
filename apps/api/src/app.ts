import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";

export const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
