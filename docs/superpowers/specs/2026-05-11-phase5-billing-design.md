# Phase 5 — Billing & Subscription Design Spec

## 1. Overview

Phase 5 implements the billing and subscription system for VILCAMI using Wompi (Sandbox-first) as the payment gateway. The model is **feature-gated subscription with device quota**, following the proven patterns of Ubidots, ThingsBoard, and Curesh — plans with devices included, features restricted by tier, and add-ons for lower tiers.

**Hard rule from CLAUDE.md:** Never advance to Wompi production without explicit user confirmation.

## 2. Architecture

```
┌──────────────────────────────────────────────────────┐
│  Middleware Layer                                      │
│  requireSubscription()  → verify subscription status  │
│  requireFeature('x')    → verify plan features        │
│  requireDeviceQuota()   → verify device limit        │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│  Billing Service Layer                                │
│  subscription.service.ts    → subscription lifecycle  │
│  usage-tracking.service.ts   → event count vs quota  │
│  plan-feature.service.ts   → plan → features map    │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│  Payment Layer (Wompi)                                │
│  wompi-adapter.ts       → Wompi API integration      │
│  webhook handler        → process payment events      │
│  signature verification → HMAC-SHA256 integrity       │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼───────────────────────────────────────┐
│  Data Layer                                           │
│  D1: payments, wompi_events (new tables)              │
│  D1: subscription_plans, device_subscriptions (exist.) │
│  KV: throttle counters, Wompi credentials per org    │
└──────────────────────────────────────────────────────┘
```

### 2.1 Payment flow

```
User clicks "Upgrade" → POST /api/billing/checkout
  → wompi-adapter creates payment link
  → Returns { url, reference, expiresAt }
  → User pays in Wompi checkout
  → Wompi sends webhook to POST /api/webhooks/wompi
  → Verify HMAC signature
  → Check idempotency (wompiEventId)
  → Store in wompi_events
  → Create payment record
  → Activate subscription (device_subscriptions.status = "active")
  → Set currentPeriodStart/End
```

### 2.2 Daily validation cron

```
Every 24h (00:00 UTC):
  → List all organizations
  → For each org:
    → Check subscription status
    → If trial expired → suspended (after 7-day grace)
    → If past_due > 7 days → suspended
    → If suspended > 30 days → cancelled
    → If active + period ends in 3 days → email notification
    → Update device_subscriptions.status accordingly
```

## 3. Plans and Feature Gating

### 3.1 Plan definitions

| | Trial | Starter | Professional | Enterprise |
|---|---|---|---|---|
| **Price (COP/device/month)** | Free | 8,500 | 14,900 | 21,500+ |
| **Devices** | 3 max | 5 max | 15 max | Unlimited |
| **Readings/hour** | 1 | 60 (1/min) | 720 (1/5s) | Unlimited |
| **Data retention** | 7 days | 30 days | 90 days | 365 days |
| **Alerts** | P0-P1 | P0-P3 | P0-P3 | P0-P3 |
| **AI Diagnostic** | - | Add-on COP 3,500 | Included | Included |
| **Compliance Reports** | - | Add-on COP 2,500 | Included | Included |
| **Advanced Escalation** | - | Add-on COP 1,500 | Included | Included |
| **Duration** | 30 days | Monthly | Monthly | Annual |
| **Support** | Email | Email | Chat | Dedicated |

### 3.2 PLAN_FEATURES constant

```typescript
const PLAN_FEATURES: Record<PlanName, PlanFeatures> = {
  trial: {
    maxDevices: 3,
    readingsPerHour: 1,
    dataRetentionDays: 7,
    alertLevels: ['p0', 'p1'],
    features: [],
  },
  starter: {
    maxDevices: 5,
    readingsPerHour: 60,
    dataRetentionDays: 30,
    alertLevels: ['p0', 'p1', 'p2', 'p3'],
    features: [], // add-ons purchased separately
  },
  professional: {
    maxDevices: 15,
    readingsPerHour: 720,
    dataRetentionDays: 90,
    alertLevels: ['p0', 'p1', 'p2', 'p3'],
    features: ['ai_diagnostic', 'compliance_reports', 'advanced_escalation'],
  },
  enterprise: {
    maxDevices: Infinity,
    readingsPerHour: Infinity,
    dataRetentionDays: 365,
    alertLevels: ['p0', 'p1', 'p2', 'p3'],
    features: ['ai_diagnostic', 'compliance_reports', 'advanced_escalation'],
  },
};
```

### 3.3 Feature gating enforcement

Three middleware functions applied to API routes:

- `requireSubscription()` — Verifies org has active/trial/past_due subscription. Suspended/cancelled orgs get `402 Payment Required` with `upgradeInfo` in response body.
- `requireFeature(featureName)` — Verifies the org's plan includes the requested feature. Returns `403 Forbidden` with `requiredPlan` in response body.
- `requireDeviceQuota()` — Verifies org has not exceeded device limit for their plan. Returns `403 Forbidden` with `currentCount`, `maxAllowed`, `upgradeUrl`.

Routes where middleware applies:

| Route | Middleware |
|---|---|
| `POST /api/devices` | `requireSubscription() + requireDeviceQuota()` |
| `POST /api/telemetry` | `requireSubscription()` |
| `POST /api/alerts/:id/shelve` | `requireFeature('advanced_escalation')` |
| AI Orchestrator cron | Checks `features.includes('ai_diagnostic')` before generating AI context |
| Compliance report generation | `requireFeature('compliance_reports')` |

## 4. Database Schema

### 4.1 New tables

**payments**

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | TEXT | PK | UUID |
| organizationId | TEXT | NOT NULL, FK → organizations.id | Org scope |
| wompiTransactionId | TEXT | NOT NULL, UNIQUE | Wompi transaction ID |
| amountInCents | INTEGER | NOT NULL | COP amount (no decimals) |
| currency | TEXT | NOT NULL, DEFAULT 'COP' | ISO 4217 |
| status | TEXT | NOT NULL | pending/completed/failed/refunded |
| paymentMethod | TEXT | | card/pse/nequi |
| planId | TEXT | FK → subscription_plans.id | Plan being paid for |
| deviceCount | INTEGER | NOT NULL, DEFAULT 1 | Devices covered |
| billingPeriodStart | INTEGER | NOT NULL | Unix timestamp |
| billingPeriodEnd | INTEGER | NOT NULL | Unix timestamp |
| wompiReference | TEXT | | Our internal reference |
| createdAt | INTEGER | NOT NULL, DEFAULT unixepoch() | |
| updatedAt | INTEGER | NOT NULL, DEFAULT unixepoch() | |

**wompi_events**

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | TEXT | PK | UUID |
| organizationId | TEXT | NOT NULL | Org scope |
| wompiEventId | TEXT | NOT NULL, UNIQUE | Idempotency key |
| eventType | TEXT | NOT NULL | transaction.approved, etc. |
| payload | TEXT | NOT NULL | Full webhook JSON |
| processedAt | INTEGER | | Null until processed |
| createdAt | INTEGER | NOT NULL, DEFAULT unixepoch() | |

### 4.2 Existing tables (no schema changes needed)

- `subscription_plans` — already has plan definitions
- `device_subscriptions` — already has status enum, period dates
- `billing_events` — already tracks API call events

### 4.3 Migration

File: `drizzle/migrations/0002_phase5_billing.sql`

## 5. Wompi Integration

### 5.1 Wompi API endpoints used

| Action | Method | Endpoint |
|---|---|---|
| Create payment link | POST | /v1/payment_links |
| Get transaction | GET | /v1/transactions/{id} |
| Accept webhook | POST | (incoming, our endpoint) |

Base URLs:
- Sandbox: `https://sandbox.wompi.co/v1`
- Production: `https://production.wompi.co/v1` (only with explicit approval)

### 5.2 KV Vault keys for Wompi

| Key | Scope | Description |
|---|---|---|
| `{orgId}:secret:wompi_public_key` | Per org | Public key for payment links |
| `{orgId}:secret:wompi_event_integrity_key` | Per org | HMAC-SHA256 key for webhook verification |
| `global:secret:wompi_test_private_key` | Global | Sandbox private key (dev only) |

### 5.3 Webhook signature verification

Wompi signs webhooks with HMAC-SHA256 using the event integrity key. The adapter must:

1. Extract `x-transaction-hash` and `timestamp` from headers
2. Compute `HMAC-SHA256(event_integrity_key, payload + timestamp)`
3. Compare with `x-transaction-hash` (constant-time comparison)
4. Reject if mismatch → respond 400

### 5.4 Webhook events processed

| Wompi Event | Action |
|---|---|
| `transaction.approved` | Create payment record (status=completed), activate subscription |
| `transaction.declined` | Create payment record (status=failed), notify org admin |
| `transaction.refunded` | Update payment record (status=refunded), adjust subscription period |
| `transaction.status_changed` | Log event, update payment status if needed |

All webhook processing is idempotent — duplicate events are detected via `wompiEventId` and skipped.

## 6. API Routes

### 6.1 Billing routes (require auth + org-scoping)

| Method | Path | Description |
|---|---|---|
| POST | /api/billing/checkout | Generate Wompi payment link |
| GET | /api/billing/subscription | Get current subscription status |
| GET | /api/billing/plans | List available plans |
| GET | /api/billing/payments | List payment history (paginated) |

### 6.2 Webhook route (no auth, HMAC verification only)

| Method | Path | Description |
|---|---|---|
| POST | /api/webhooks/wompi | Receive Wompi payment events |

## 7. Subscription Lifecycle

```
trial ──(30 days)──→ active ──(period ends)──→ past_due ──(7 days)──→ suspended ──(30 days)──→ cancelled
  │                    │                          │                        │
  │                    │←── payment approved ─────│                        │
  │                    │                          │←── payment approved ───│ (grace period)
  │                    │                                                   │
  └──(upgrade)──→ active                                                   └──(reactivation)──→ active
```

| Status | API Behavior | Devices | Readings | Features |
|---|---|---|---|---|
| `trial` | Normal | 3 max | 1/hour | P0-P1 only |
| `active` | Normal | Per plan | Per plan | Per plan |
| `past_due` | Normal + `X-Subscription-Past-Due` header | Per plan | Per plan | Per plan (7-day grace) |
| `suspended` | `402 Payment Required` + upgradeInfo | Read-only | Blocked | None |
| `cancelled` | `401 Unauthorized` | Blocked | Blocked | None |

## 8. Usage Tracking & Throttling

### 8.1 Throttle mechanism (KV-based)

```
Key:   throttle:{orgId}:{deviceId}:{hourBucket}
Value: { count: number, maxAllowed: number }
TTL:   1 hour
```

When a telemetry reading arrives:
1. Check KV throttle key for this org + device + current hour
2. If count < maxAllowed → accept reading, increment counter
3. If count >= maxAllowed → reject reading with `429 Too Many Requests`
4. First reading of the hour → create key with TTL 3600

### 8.2 Billing events

Every accepted or rejected reading creates a `billing_events` record for analytics. The `eventType` field distinguishes `api_call_tuya` vs `api_call_modbus`.

## 9. Cron Jobs

### 9.1 Daily validation cron

Added to `src/index.ts` scheduled handler:

```typescript
scheduled: async (event, env, ctx) => {
  ctx.waitUntil(runHourlyAggregation(env));
  ctx.waitUntil(runIntelligentMonitoringCycle(env));
  ctx.waitUntil(runBillingValidationCycle(env)); // NEW
};
```

Wompi cron triggers (daily at 00:00 UTC):

```
trigger: "0 0 * * *"  // daily at midnight UTC
```

### 9.2 Validation cycle logic

```typescript
async function runBillingValidationCycle(env: Env): Promise<void> {
  // 1. Get all organizations
  // 2. For each org, check device_subscriptions
  // 3. Apply state transitions based on time elapsed
  // 4. Send notifications (3 days before expiry)
  // 5. Update device_subscriptions.status
  // 6. Sequential processing, try/catch per org
}
```

## 10. Env Bindings

### 10.1 wrangler.toml additions

```toml
[vars]
WOMPI_BASE_URL = "https://sandbox.wompi.co/v1"

# New KV namespace for throttle counters
[[kv_namespaces]]
binding = "THROTTLE_KV"
id = "<placeholder>"
```

### 10.2 env.ts additions

```typescript
export interface Env {
  // ... existing bindings
  WOMPI_BASE_URL: string;
  THROTTLE_KV: KVNamespace;
}
```

## 11. File Structure

```
src/
  adapters/
    wompi-adapter.ts              (~150 lines) — Wompi API integration
  middleware/
    subscription.middleware.ts     (~80 lines) — requireSubscription/requireFeature/requireDeviceQuota
  routes/
    billing.routes.ts             (~120 lines) — checkout, subscription, plans, payments
    webhook.routes.ts             (~60 lines) — Wompi webhook (no auth)
  services/
    subscription.service.ts       (~180 lines) — subscription lifecycle management
    usage-tracking.service.ts     (~100 lines) — KV throttle + billing events
    plan-feature.service.ts       (~60 lines) — PLAN_FEATURES map + feature checks
    billing-cron.service.ts       (~100 lines) — daily validation cycle
  validators/
    billing.validator.ts          (existing, extend) — add payment/checkout validators
    webhook.validator.ts           (~40 lines) — Wompi webhook payload validation
  types/
    wompi.ts                      (~60 lines) — Wompi API types
    billing.types.ts              (~50 lines) — PlanFeatures, SubscriptionStatus, etc.
  test/
    services/subscription.test.ts
    services/usage-tracking.test.ts
    services/plan-feature.test.ts
    services/billing-cron.test.ts
    adapters/wompi-adapter.test.ts
    middleware/subscription-middleware.test.ts
    routes/billing.test.ts
    routes/webhook.test.ts
```

## 12. Implementation Order

1. **Types + Plan features** — billing.types.ts, plan-feature.service.ts, wompi.ts
2. **Database migration** — 0002_phase5_billing.sql + Drizzle schemas
3. **Subscription service** — lifecycle management + status transitions
4. **Usage tracking** — KV throttle + billing events recording
5. **Wompi adapter** — API integration + signature verification
6. **Middleware** — requireSubscription, requireFeature, requireDeviceQuota
7. **Routes** — billing + webhook endpoints
8. **Cron** — daily validation cycle
9. **Integration** — wire middleware to existing routes, update env types + wrangler.toml
10. **Tests** — TDD throughout

## 13. Security Considerations

- Wompi webhook endpoint has NO JWT auth — security comes from HMAC signature verification
- All payment amounts stored as integer cents (no floating-point)
- Wompi credentials stored in KV Vault per organization (not in wrangler.toml)
- Payment link URLs expire after a configurable timeout
- Idempotency on webhook processing prevents double-activation
- Suspended/cancelled orgs cannot create devices or send telemetry
- Trial orgs limited to 3 devices with 1 reading/hour (prevents abuse)

## 14. Out of Scope (Phase 6+)

- Invoice generation (Wompi handles invoices)
- Multi-currency billing (COP only for now, schema supports extension)
- Annual billing discounts
- Prorated device addition (device added mid-period charges full month)
- Payment method management (Wompi handles card tokenization)