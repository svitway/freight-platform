import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { calculateRoute } from "../modules/routing/open-route-service.js";
import { calculateRoutePrice } from "../modules/pricing/pricing.js";

const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

const routePointSchema = z.union([
  z.object({
    address: z.string().trim().min(3),
    coordinates: z.never().optional()
  }),
  z.object({
    coordinates: coordinateSchema,
    address: z.never().optional()
  })
]);

const createQuoteSchema = z.object({
  origin: routePointSchema,
  destination: routePointSchema
});

export const quoteRoutes: FastifyPluginAsync = async (app) => {
  app.post("/", async (request, reply) => {
    const input = createQuoteSchema.parse(request.body);
    const route = await calculateRoute(input.origin, input.destination);
    const price = calculateRoutePrice(route.countries);
    const expiresAt = new Date(Date.now() + env.QUOTE_TTL_MINUTES * 60 * 1000);

    const quote = await prisma.quote.create({
      data: {
        originInput: pointLabel(input.origin),
        destinationInput: pointLabel(input.destination),
        originLat: route.origin.lat,
        originLng: route.origin.lng,
        destinationLat: route.destination.lat,
        destinationLng: route.destination.lng,
        distanceKm: new Prisma.Decimal(price.distanceKm),
        currency: price.currency,
        priceCents: price.priceCents,
        countries: price.countries as unknown as Prisma.InputJsonValue,
        expiresAt
      }
    });

    return reply.code(201).send({
      quoteId: quote.id,
      distanceKm: price.distanceKm,
      priceCents: price.priceCents,
      currency: price.currency,
      expiresAt: quote.expiresAt.toISOString()
    });
  });
};

function pointLabel(point: z.infer<typeof routePointSchema>): string {
  if (point.address) {
    return point.address;
  }

  if (!point.coordinates) {
    throw new Error("Route point must include address or coordinates.");
  }

  return `${point.coordinates.lat},${point.coordinates.lng}`;
}
