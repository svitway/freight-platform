import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { HttpError } from "../lib/http-error.js";
import { generateApplicationNumber } from "../lib/application-number.js";
import { normalizePhone, phoneLookupHash } from "../lib/phone.js";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const checkoutSchema = z.object({
  quoteId: z.string().min(1),
  customer: z.object({
    fullNameOrCompany: z.string().trim().min(2),
    taxNumber: z.string().trim().max(64).optional(),
    email: z.string().trim().email(),
    phone: z.string().trim().min(7)
  })
});

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  app.post("/checkout", async (request, reply) => {
    const input = checkoutSchema.parse(request.body);
    const quote = await prisma.quote.findUnique({ where: { id: input.quoteId } });

    if (!quote || quote.expiresAt < new Date()) {
      throw new HttpError(404, "QUOTE_NOT_FOUND", "Quote was not found or has expired.");
    }

    const normalizedPhone = normalizePhone(input.customer.phone);
    const application = await createApplicationWithUniqueNumber({
      quoteId: quote.id,
      fullNameOrCompany: input.customer.fullNameOrCompany,
      taxNumber: input.customer.taxNumber || null,
      email: input.customer.email,
      phone: normalizedPhone,
      phoneLookupHash: phoneLookupHash(normalizedPhone)
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: input.customer.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: quote.currency.toLowerCase(),
            unit_amount: quote.priceCents,
            product_data: {
              name: "Freight transportation application",
              metadata: {
                applicationId: application.id,
                quoteId: quote.id
              }
            }
          }
        }
      ],
      success_url: `${env.STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: env.STRIPE_CANCEL_URL,
      metadata: {
        applicationId: application.id,
        applicationNumber: application.applicationNumber,
        quoteId: quote.id
      },
      payment_intent_data: {
        metadata: {
          applicationId: application.id,
          applicationNumber: application.applicationNumber,
          quoteId: quote.id
        }
      }
    });

    if (!session.url) {
      throw new HttpError(502, "STRIPE_SESSION_URL_MISSING", "Stripe did not return a checkout URL.");
    }

    await prisma.payment.create({
      data: {
        applicationId: application.id,
        stripeCheckoutSessionId: session.id,
        amountCents: quote.priceCents,
        currency: quote.currency
      }
    });

    return reply.code(201).send({
      checkoutUrl: session.url,
      checkoutSessionId: session.id
    });
  });

  app.get("/checkout-session/:sessionId", async (request) => {
    const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
    const payment = await prisma.payment.findUnique({
      where: { stripeCheckoutSessionId: params.sessionId },
      include: {
        application: {
          include: {
            quote: true
          }
        }
      }
    });

    if (!payment) {
      throw new HttpError(404, "PAYMENT_NOT_FOUND", "Payment was not found.");
    }

    const paid = payment.application.status === "PAID" && payment.status === "PAID";

    return {
      paid,
      status: payment.application.status,
      applicationNumber: paid ? payment.application.applicationNumber : null,
      distanceKm: Number(payment.application.quote.distanceKm),
      priceCents: payment.application.quote.priceCents,
      currency: payment.application.quote.currency
    };
  });
};

async function createApplicationWithUniqueNumber(data: {
  quoteId: string;
  fullNameOrCompany: string;
  taxNumber: string | null;
  email: string;
  phone: string;
  phoneLookupHash: string;
}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.application.create({
        data: {
          ...data,
          applicationNumber: generateApplicationNumber()
        }
      });
    } catch (error) {
      if (isUniqueApplicationNumberConflict(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new HttpError(500, "APPLICATION_NUMBER_COLLISION", "Could not generate unique application number.");
}

function isUniqueApplicationNumberConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
