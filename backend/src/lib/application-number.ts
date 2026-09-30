import { randomBytes } from "node:crypto";

export function generateApplicationNumber(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const token = randomBytes(4).toString("hex").toUpperCase();

  return `FT-${date}-${token}`;
}
