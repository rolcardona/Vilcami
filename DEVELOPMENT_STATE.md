# ESTADO DEL PROYECTO: VILCAMI

## Estado Actual
**FASE 1 — DATA: Completada**
- Drizzle schemas: 16 tablas implementadas
- Zod validators: 5 validators implementados
- KV Vault (AES-GCM): Implementado (Web Crypto puro, sin Buffer)
- Migraciones D1: generadas
- Worker entry point: Implementado (Hono)

**FASE 2 — IOT: Completada**
- DeviceAdapter interface + SimulatedDeviceProvider (sine-wave + Gaussian noise)
- Telemetry ingestion service (single + bulk, KV con TTL 7 dias)
- Device management service (CRUD con org-scoping, sensores default)
- Device routes: 5 endpoints (list, get, create, update, delete)
- Telemetry routes: 3 endpoints (ingest, bulk ingest, get recent)
- Aggregation cron (hourly + daily, pure functions, Welford stddev)
- Device auto-collection cron (harvests simulated telemetry -> ingestion pipeline)
- Worker composition root wired (routes + cron, Drizzle ORM, ExecutionContext)

**FASE 3 — AUTH: Completada**
- JWKS Cache Service: fetches Supabase JWKS, caches in KV with 1h TTL + in-memory fallback
- JWT Verifier: RS256 signature verification against JWKS (crypto.subtle.verify)
- Auth Middleware: real JWT verification replacing base64-decoding stub
- MFA enforcement: admin role blocked (403) unless aal2 claim present; admin_vilcami bypass
- org_id null handling: null org_id returns 403 on org-scoped routes
- Supabase custom claims hook: injects org_id and role from organization_members into JWT
- Supabase CLI config + migrations (organizations + organization_members tables)
- Integration test: 7 tests covering full authMiddleware → orgScopingMiddleware chain
- Total: 198/198 tests pasando, 0 TypeScript errors

**FASE 4 — AI: Completada**
- DB schemas: alerts, push_subscriptions, member_profiles, alert_lifecycle (FK), alert_rules (conditionOperator enum extendido), alert_escalations, alert_audit_log
- Zod validators: ai-context.validator.ts, alert.validator.ts (5 endpoint validators)
- Rule Engine helpers: 6 pure functions (P0-P3) + 41 tests
- Rule Engine service: evaluateRules orchestrator + 9 tests
- Alert Generator: Workers AI (@cf/meta/llama-3-8b-instruct) + fallback template + 12 tests
- Notification adapters: Twilio, Email, Push, Registry factory + 66 tests
- Notification Dispatcher: severity routing (P0-P3) + 19 tests
- Alert Management service + routes: 7 endpoints (list, get, acknowledge, resolve, shelve, active count, push subscribe) + 20 tests
- AI Orchestrator: cron-driven monitoring cycle (sequential org processing, error isolation) + 5 tests
- Workers AI binding: env.ts (Ai type), wrangler.toml ([ai] section), migration
- Total: 370 tests pasando, 0 TypeScript errors

## Estructura del Proyecto (Actualizada)
```
src/
  adapters/
    device-adapter.interface.ts
    simulated-device.provider.ts
    device-adapter.factory.ts
    notification-adapter.interface.ts
    notification-twilio.adapter.ts
    notification-email.adapter.ts
    notification-push.adapter.ts
    notification-registry.ts
    wompi-adapter.ts
  auth/
    jwks-cache.service.ts
    jwt-verifier.ts
  db/
    schemas/ (16 tablas)
  middleware/
    auth.middleware.ts
    subscription.middleware.ts
  routes/
    devices.routes.ts
    telemetry.routes.ts
    alerts.routes.ts
    billing.routes.ts
    webhook.routes.ts
  services/
    aggregation-cron.service.ts
    aggregation-cron.helpers.ts
    device-collection-cron.service.ts
    device-management.service.ts
    telemetry-ingestion.service.ts
    rule-engine.helpers.ts
    rule-engine.service.ts
    rule-engine.types.ts
    alert-generator.service.ts
    notification-dispatcher.service.ts
    alert-management.service.ts
    ai-orchestrator.service.ts
    subscription.service.ts
    billing-cron.service.ts
    usage-tracking.service.ts
    plan-feature.service.ts
  utils/
    db.util.ts
    gaussian-noise.util.ts
  validators/ (8 validators — added billing checkout + webhook)
  index.ts
  types/
    env.ts
    billing.types.ts
    wompi.ts
supabase/
  config.toml
  migrations/
    000_organizations.sql
    001_custom_claims_hook.sql
```

**FASE 5 — BILLING: Completada**
- billing.types.ts: PlanName, SubscriptionStatus, PaymentStatus, PaymentMethod, FeatureName, PlanFeatures, CheckoutRequest, SubscriptionResponse, PaymentResponse
- wompi.ts: WompiPaymentLinkRequest, WompiPaymentLinkResponse, WompiTransaction, WompiWebhookPayload, WompiWebhookHeaders
- plan-feature.service.ts: PLAN_FEATURES constant + 4 helper functions (getPlanFeatures, hasFeature, getDeviceLimit, getReadingsPerHourLimit)
- billing.validator.ts: extended with checkoutRequestValidator, wompiWebhookValidator, planNameValidator, paymentQueryValidator
- plan-feature.service.test.ts: 21 TDD tests (all passing)
- payments + wompi_events schemas (Drizzle ORM)
- subscription.service.ts: lifecycle management + status transitions
- subscription-middleware.ts: requireSubscription, requireFeature, requireDeviceQuota
- wompi-adapter.ts: createPaymentLink, verifyWebhookSignature (HMAC-SHA256), handleWebhookEvent (idempotent)
- billing.routes.ts: POST /checkout, GET /subscription, GET /plans, GET /payments (auth + org-scoped)
- webhook.routes.ts: POST /webhooks/wompi (NO auth, HMAC-only verification)
- billing-cron.service.ts: runBillingValidationCycle — daily subscription lifecycle enforcement (trial→suspended, past_due→suspended, suspended→cancelled, 3-day expiry warning)
- env.ts: added WOMPI_PUBLIC_KEY, WOMPI_EVENT_INTEGRITY_KEY
- index.ts: wired billing + webhook routes + cron trigger
- billing-integration.test.ts: 8 integration tests (full lifecycle, middleware+routes, webhook flow, cron transitions)
- billing-edge-cases.test.ts: 12 edge case tests (cancelled terminal state, idempotent activation, throttle at exact limit, new hour bucket, old HMAC timestamp, invalid HMAC, duplicate webhook idempotency, enterprise Infinity limits, starter/trial empty features)
- Total: 516 tests pasando, 0 TypeScript errors (source)

## Próximos pasos
1. **FASE 6 — UI:** 4 dashboards — ver `apps/web/`

## Errores conocidos
- wrangler.toml tiene IDs PLACEHOLDER para D1 y KV — crear recursos reales con `wrangler login` + `wrangler d1 create` + `wrangler kv namespace create`
- vitest environment es "node" (no Workers pool) — migrar a `@cloudflare/vitest-pool-workers` antes de Fase 6
- Tests usan mocks de Drizzle con patrón chainable (no distinguen queries individuales) — mejorar en producción

## Decisiones de Arquitectura (resumen)
- Roles: admin_vilcami (plataforma) + admin (org, MFA obligatorio) + user (org)
- Billing: COP hibrido, 3 planes + add-ons, 1 evento = 1 API call
- Alertas: P0-P3, WhatsApp+Push+SMS, ISA-18.2
- IA: Reactiva + Diagnostica + Meteorologica (Open-Meteo)
- Cumplimiento: HACCP (CA), INVIMA/Dec1500/Res240 (CO), EN12830
- D1: 1 DB por org + KV con TTL 7d para telemetria cruda
- Trial: 30 dias, 3 dispositivos, sin add-ons
- Vault: Web Crypto puro (btoa/atob), sin dependencia de Buffer ni nodejs_compat para cifrado
- Severity: alert_rules usan p0-p3, alerts y notifications usan critical/high/medium/low
- Orchestrator: procesa organizaciones secuencialmente, error isolation por org