import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { HttpError } from "../lib/http-error.js";
import { phoneLookupHash } from "../lib/phone.js";

const lookupSchema = z.object({
  applicationNumber: z.string().trim().min(6),
  phone: z.string().trim().min(7)
});

export const applicationRoutes: FastifyPluginAsync = async (app) => {
  app.post("/lookup", async (request) => {
    const input = lookupSchema.parse(request.body);
    const application = await prisma.application.findFirst({
      where: {
        applicationNumber: input.applicationNumber.toUpperCase(),
        phoneLookupHash: phoneLookupHash(input.phone),
        status: "PAID"
      },
      include: {
        quote: true,
        payment: true
      }
    });

    if (!application) {
      throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application was not found.");
    }

    return {
      applicationNumber: application.applicationNumber,
      status: application.status,
      paidAt: application.paidAt?.toISOString() ?? null,
      customer: {
        fullNameOrCompany: application.fullNameOrCompany,
        taxNumber: application.taxNumber,
        email: application.email,
        phone: application.phone
      },
      route: {
        origin: application.quote.originInput,
        destination: application.quote.destinationInput,
        distanceKm: Number(application.quote.distanceKm)
      },
      price: {
        priceCents: application.quote.priceCents,
        currency: application.quote.currency
      }
    };
  });
};
