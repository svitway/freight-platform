# Freight Platform Backend

Backend MVP for route price calculation, paid shipment applications, and lookup without user accounts.

## Flow

1. `POST /api/quotes` calculates a route with OpenRouteService and stores the quote.
2. `POST /api/payments/checkout` creates an application in `PENDING_PAYMENT` status and opens Stripe Checkout.
3. `POST /api/webhooks/stripe` marks the application as `PAID` after Stripe confirms payment.
4. `GET /api/payments/checkout-session/:sessionId` lets the frontend show the application number after payment.
5. `POST /api/applications/lookup` returns an already paid application by `applicationNumber + phone`.

## Setup

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

The country rates in `src/config/country-rates.ts` are placeholders. Replace them with the real tariff table before production use.
