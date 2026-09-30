import { createHmac } from "node:crypto";
import { env } from "../env.js";
import { HttpError } from "./http-error.js";

export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  const leadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length < 7 || digits.length > 15) {
    throw new HttpError(400, "INVALID_PHONE", "Phone number must contain 7 to 15 digits.");
  }

  return leadingPlus ? `+${digits}` : digits;
}

export function phoneLookupHash(phone: string): string {
  const normalized = normalizePhone(phone);

  return createHmac("sha256", env.PHONE_LOOKUP_SECRET).update(normalized).digest("hex");
}
