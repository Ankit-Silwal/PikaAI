import { app } from "./app.js";
import { prisma } from "./db.js";

const port = Number(process.env.PORT ?? 3001);

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Database connected");
} catch (error) {
  console.error("Database connection error:", error);
}

app.listen(port, () => {
  console.log("Backend listening on port " + port);
});
