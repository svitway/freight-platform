import { ORS_COUNTRIES_BY_ID } from "../../config/ors-country-ids.js";
import { env } from "../../env.js";
import { HttpError } from "../../lib/http-error.js";
import type { RouteCountrySegment } from "../pricing/pricing.js";

const ORS_BASE_URL = "https://api.openrouteservice.org";

export type Coordinates = {
  lat: number;
  lng: number;
};

export type RoutePointInput =
  | { address: string; coordinates?: never }
  | { coordinates: Coordinates; address?: never };

export type ResolvedRoutePoint = Coordinates & {
  label: string;
};

export type RouteCalculation = {
  origin: ResolvedRoutePoint;
  destination: ResolvedRoutePoint;
  distanceKm: number;
  durationSeconds: number | null;
  countries: RouteCountrySegment[];
};

export async function calculateRoute(
  originInput: RoutePointInput,
  destinationInput: RoutePointInput
): Promise<RouteCalculation> {
  const [origin, destination] = await Promise.all([
    resolveRoutePoint(originInput),
    resolveRoutePoint(destinationInput)
  ]);

  const route = await requestDirections(origin, destination);

  return {
    origin,
    destination,
    ...route
  };
}

async function resolveRoutePoint(input: RoutePointInput): Promise<ResolvedRoutePoint> {
  if (input.coordinates) {
    const { lat, lng } = input.coordinates;

    return {
      lat,
      lng,
      label: `${lat},${lng}`
    };
  }

  return geocodeAddress(input.address);
}

async function geocodeAddress(address: string): Promise<ResolvedRoutePoint> {
  const url = new URL("/geocode/search", ORS_BASE_URL);
  url.searchParams.set("api_key", env.ORS_API_KEY);
  url.searchParams.set("text", address);
  url.searchParams.set("size", "1");

  const response = await fetch(url);
  const payload = (await response.json().catch(() => null)) as OrsGeocodeResponse | null;

  if (!response.ok) {
    throw new HttpError(response.status, "ORS_GEOCODE_ERROR", "OpenRouteService geocoding failed.", payload);
  }

  const feature = payload?.features?.[0];
  const coordinates = feature?.geometry?.coordinates;

  if (!coordinates || coordinates.length < 2) {
    throw new HttpError(422, "ADDRESS_NOT_FOUND", "Address could not be geocoded.", { address });
  }

  return {
    lng: coordinates[0],
    lat: coordinates[1],
    label: feature.properties?.label ?? address
  };
}

async function requestDirections(
  origin: Coordinates,
  destination: Coordinates
): Promise<Omit<RouteCalculation, "origin" | "destination">> {
  const response = await fetch(`${ORS_BASE_URL}/v2/directions/${env.ORS_PROFILE}/geojson`, {
    method: "POST",
    headers: {
      Authorization: env.ORS_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      coordinates: [
        [origin.lng, origin.lat],
        [destination.lng, destination.lat]
      ],
      extra_info: ["countryinfo"],
      options: {
        avoid_features: ["tollways"]
      },
      units: "m"
    })
  });

  const payload = (await response.json().catch(() => null)) as OrsDirectionsResponse | null;

  if (!response.ok) {
    throw new HttpError(response.status, "ORS_DIRECTIONS_ERROR", "OpenRouteService route calculation failed.", payload);
  }

  const feature = payload?.features?.[0];
  const properties = feature?.properties;
  const summary = properties?.summary;
  const distanceMeters = summary?.distance;

  if (typeof distanceMeters !== "number") {
    throw new HttpError(502, "ORS_INVALID_ROUTE", "OpenRouteService response did not include route distance.", payload);
  }

  return {
    distanceKm: Math.round((distanceMeters / 1000) * 100) / 100,
    durationSeconds: typeof summary?.duration === "number" ? summary.duration : null,
    countries: parseCountrySegments(properties?.extras, distanceMeters)
  };
}

function parseCountrySegments(extras: unknown, totalDistanceMeters: number): RouteCountrySegment[] {
  const countryInfo = readRecord(readRecord(extras)?.countryinfo);
  const summary = Array.isArray(countryInfo?.summary) ? countryInfo.summary : [];

  if (summary.length === 0) {
    return [
      {
        countryId: null,
        countryCode: "UNKNOWN",
        countryName: "Unknown",
        distanceKm: Math.round((totalDistanceMeters / 1000) * 100) / 100
      }
    ];
  }

  return summary.map((item) => {
    const record = readRecord(item);
    const countryId = typeof record?.value === "number" ? record.value : null;
    const country = countryId ? ORS_COUNTRIES_BY_ID[countryId] : null;
    const distanceMeters = typeof record?.distance === "number" ? record.distance : 0;

    return {
      countryId,
      countryCode: country?.iso2 ?? `ORS_${countryId ?? "UNKNOWN"}`,
      countryName: country?.name ?? `OpenRouteService country ${countryId ?? "unknown"}`,
      distanceKm: Math.round((distanceMeters / 1000) * 100) / 100
    };
  });
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

type OrsGeocodeResponse = {
  features?: Array<{
    geometry?: {
      coordinates?: [number, number];
    };
    properties?: {
      label?: string;
    };
  }>;
};

type OrsDirectionsResponse = {
  features?: Array<{
    properties?: {
      summary?: {
        distance?: number;
        duration?: number;
      };
      extras?: unknown;
    };
  }>;
};
