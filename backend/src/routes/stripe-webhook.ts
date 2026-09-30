import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import Stripe from "stripe";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { HttpError } from "../lib/http-error.js";

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

type RawBodyRequest = FastifyRequest & {
  rawBody?: Buffer | string;
};

export const stripeWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/stripe", { config: { rawBody: true } }, async (request, reply) => {
    const signature = request.headers["stripe-signature"];
    const rawBody = (request as RawBodyRequest).rawBody;

    if (!signature || Array.isArray(signature) || !rawBody) {
      throw new HttpError(400, "STRIPE_SIGNATURE_MISSING", "Stripe webhook signature is missing.");
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch {
      throw new HttpError(400, "STRIPE_SIGNATURE_INVALID", "Stripe webhook signature is invalid.");
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await markCheckoutSessionPaid(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.async_payment_failed":
        await markCheckoutSessionFailed(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.expired":
        await markCheckoutSessionExpired(event.data.object as Stripe.Checkout.Session);
        break;
      default:
        request.log.info({ type: event.type }, "Ignoring Stripe event");
    }

    return reply.send({ received: true });
  });
};

async function markCheckoutSessionPaid(session: Stripe.Checkout.Session): Promise<void> {
  const applicationId = session.metadata?.applicationId;

  if (!applicationId) {
    return;
  }

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { quote: true }
  });

  if (!application) {
    return;
  }

  const paymentIntentId = stripeId(session.payment_intent);
  const amountCents = session.amount_total ?? application.quote.priceCents;
  const currency = (session.currency ?? application.quote.currency).toUpperCase();

  await prisma.$transaction([
    prisma.payment.upsert({
      where: { stripeCheckoutSessionId: session.id },
      update: {
        status: "PAID",
        stripePaymentIntentId: paymentIntentId,
        amountCents,
        currency
      },
      create: {
        applicationId: application.id,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        status: "PAID",
        amountCents,
        currency
      }
    }),
    prisma.application.update({
      where: { id: application.id },
      data: {
        status: "PAID",
        paidAt: application.paidAt ?? new Date()
      }
    })
  ]);
}

async function markCheckoutSessionFailed(session: Stripe.Checkout.Session): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { stripeCheckoutSessionId: session.id }
  });

  if (!payment) {
    return;
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        stripePaymentIntentId: stripeId(session.payment_intent)
      }
    }),
    prisma.application.updateMany({
      where: {
        id: payment.applicationId,
        status: "PENDING_PAYMENT"
      },
      data: {
        status: "PAYMENT_FAILED"
      }
    })
  ]);
}

async function markCheckoutSessionExpired(session: Stripe.Checkout.Session): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { stripeCheckoutSessionId: session.id }
  });

  if (!payment) {
    return;
  }

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "EXPIRED"
      }
    }),
    prisma.application.updateMany({
      where: {
        id: payment.applicationId,
        status: "PENDING_PAYMENT"
      },
      data: {
        status: "CANCELLED"
      }
    })
  ]);
}

function stripeId(value: string | Stripe.PaymentIntent | null): string | null {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id;
}
