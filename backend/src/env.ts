import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  DATABASE_URL: z.string().min(1),

  ORS_API_KEY: z.string().min(1),
  ORS_PROFILE: z.enum(["driving-hgv", "driving-car"]).default("driving-hgv"),
  QUOTE_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  CURRENCY: z.string().length(3).default("EUR"),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_SUCCESS_URL: z.string().url(),
  STRIPE_CANCEL_URL: z.string().url(),

  PHONE_LOOKUP_SECRET: z.string().min(16)
});

export const env = envSchema.parse(process.env);

export const corsOrigins =
  env.CORS_ORIGIN === "*"
    ? true
    : env.CORS_ORIGIN.split(",").map((origin) => origin.trim());
