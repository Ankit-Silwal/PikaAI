import { app } from "./app.js";
import { prisma } from "./configs/db.js";
import { env } from "./configs/env.js";

const port = env.port;

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Database connected");
} catch (error) {
  console.error("Database connection error:", error);
}

app.listen(port, () => {
  console.log("Backend listening on port " + port);
});
