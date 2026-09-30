import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import rawBody from "fastify-raw-body";
import { ZodError } from "zod";
import { corsOrigins, env } from "./env.js";
import { HttpError } from "./lib/http-error.js";
import { applicationRoutes } from "./routes/applications.js";
import { paymentRoutes } from "./routes/payments.js";
import { quoteRoutes } from "./routes/quotes.js";
import { stripeWebhookRoutes } from "./routes/stripe-webhook.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL
    }
  });

  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true
  });

  await app.register(cors, {
    origin: corsOrigins
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });

  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : "Unexpected server error.";

    request.log.error({ error }, message);

    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.flatten()
        }
      });
    }

    return reply.status(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error."
      }
    });
  });

  app.get("/api/health", async () => ({
    ok: true
  }));

  await app.register(quoteRoutes, { prefix: "/api/quotes" });
  await app.register(paymentRoutes, { prefix: "/api/payments" });
  await app.register(applicationRoutes, { prefix: "/api/applications" });
  await app.register(stripeWebhookRoutes, { prefix: "/api/webhooks" });

  return app;
}
