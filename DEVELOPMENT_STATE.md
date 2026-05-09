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

## Estructura del Proyecto (Actualizada)
```
src/
  adapters/
    device-adapter.interface.ts
    simulated-device.provider.ts
    device-adapter.factory.ts
  auth/
    jwks-cache.service.ts
    jwt-verifier.ts
  db/
    schemas/ (16 tablas)
    index.ts
  middleware/
    auth.middleware.ts
  routes/
    devices.routes.ts
    telemetry.routes.ts
  services/
    aggregation-cron.service.ts
    aggregation-cron.helpers.ts
    device-collection-cron.service.ts
    device-management.service.ts
    telemetry-ingestion.service.ts
  utils/
    db.util.ts
    gaussian-noise.util.ts
  validators/ (5 validators)
  index.ts
  types/
    env.ts
supabase/
  config.toml
  migrations/
    000_organizations.sql
    001_custom_claims_hook.sql
```

## Próximos pasos
1. **FASE 4 — AI:** Orquestador IA, reglas industriales, reportes de impacto
2. **FASE 5 — BILLING:** Wompi Sandbox -> webhooks -> validacion diaria
3. **FASE 6 — UI:** 4 dashboards — ver `apps/web/`

## Errores conocidos
- wrangler.toml tiene IDs PLACEHOLDER para D1 y KV — crear recursos reales con `wrangler login` + `wrangler d1 create` + `wrangler kv namespace create`
- vitest environment es "node" (no Workers pool) — migrar a `@cloudflare/vitest-pool-workers` antes de Fase 6
- Tests usan mocks de Drizzle con patrón chainable (no distinguen queries individuales) — mejorar en Fase 4

## Decisiones de Arquitectura (resumen)
- Roles: admin_vilcami (plataforma) + admin (org, MFA obligatorio) + user (org)
- Billing: COP hibrido, 3 planes + add-ons, 1 evento = 1 API call
- Alertas: P0-P3, WhatsApp+Push+SMS, ISA-18.2
- IA: Reactiva + Diagnostica + Meteorologica (Open-Meteo)
- Cumplimiento: HACCP (CA), INVIMA/Dec1500/Res240 (CO), EN12830
- D1: 1 DB por org + KV con TTL 7d para telemetria cruda
- Trial: 30 dias, 3 dispositivos, sin add-ons
- Vault: Web Crypto puro (btoa/atob), sin dependencia de Buffer ni nodejs_compat para cifrado