import { COUNTRY_RATES } from "../../config/country-rates.js";
import { env } from "../../env.js";
import { HttpError } from "../../lib/http-error.js";

export type RouteCountrySegment = {
  countryId: number | null;
  countryCode: string;
  countryName: string;
  distanceKm: number;
};

export type PricedCountrySegment = RouteCountrySegment & {
  rateCentsPerKm: number;
  priceCents: number;
};

export type PriceCalculation = {
  distanceKm: number;
  priceCents: number;
  currency: string;
  countries: PricedCountrySegment[];
};

export function calculateRoutePrice(segments: RouteCountrySegment[]): PriceCalculation {
  if (segments.length === 0) {
    throw new HttpError(422, "NO_COUNTRY_SEGMENTS", "Route did not return country distance data.");
  }

  const countries = segments.map((segment) => {
    const rate = COUNTRY_RATES[segment.countryCode];

    if (!rate) {
      throw new HttpError(
        422,
        "MISSING_COUNTRY_RATE",
        `Missing price per km for ${segment.countryCode}.`,
        { countryCode: segment.countryCode, countryName: segment.countryName }
      );
    }

    const priceCents = Math.round(segment.distanceKm * rate.centsPerKm);

    return {
      ...segment,
      distanceKm: roundKm(segment.distanceKm),
      rateCentsPerKm: rate.centsPerKm,
      priceCents
    };
  });

  return {
    distanceKm: roundKm(countries.reduce((sum, item) => sum + item.distanceKm, 0)),
    priceCents: countries.reduce((sum, item) => sum + item.priceCents, 0),
    currency: env.CURRENCY,
    countries
  };
}

export function roundKm(value: number): number {
  return Math.round(value * 100) / 100;
}
