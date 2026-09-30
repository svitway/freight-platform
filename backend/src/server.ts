import { prisma } from "./db.js";
import { env } from "./env.js";
import { buildApp } from "./app.js";

const app = await buildApp();

const close = async () => {
  await app.close();
  await prisma.$disconnect();
};

process.on("SIGINT", () => {
  void close().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void close().finally(() => process.exit(0));
});

try {
  await app.listen({
    port: env.PORT,
    host: "0.0.0.0"
  });
} catch (error) {
  app.log.error(error);
  await close();
  process.exit(1);
}
