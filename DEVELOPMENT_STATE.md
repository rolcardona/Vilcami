# ESTADO DEL PROYECTO: VILCAMI

## Estado Actual
**FASE 1 — DATA: Completada**
- Drizzle schemas: 16 tablas implementadas
- Zod validators: 5 validators implementados
- KV Vault (AES-GCM): Implementado
- JWT Auth Stub: Implementado
- Migraciones D1: Generadas
- Worker entry point: Implementado (Hono)
- 57/57 tests pasando

## Próximos pasos
1. **FASE 2 — IOT:** Workers Tuya + Modbus/RS485 + ingesta de telemetría
2. **FASE 3 — AUTH:** Supabase Auth + JWT middleware real + MFA enforcement
3. **FASE 4 — AI:** Orquestador IA, reglas industriales, reportes de impacto
4. **FASE 5 — BILLING:** Wompi Sandbox → webhooks → validación diaria
5. **FASE 6 — UI:** 4 dashboards — ver `apps/web/`

## Errores conocidos
- wrangler.toml tiene IDs PLACEHOLDER para D1 y KV — crear recursos reales con `wrangler login` + `wrangler d1 create` + `wrangler kv namespace create`
- TypeScript strict mode: test files acceden a `.config` protegido en Drizzle columns (preexistente, no bloqueante)
- kv-vault.util.ts usa `Buffer` que requiere `@types/node` o flag `nodejs_compat` (preexistente, no bloqueante)

## Decisiones de Arquitectura (resumen)
- Roles: admin_vilcami (plataforma) + admin (org, MFA obligatorio) + user (org)
- Billing: COP híbrido, 3 planes + add-ons, 1 evento = 1 API call
- Alertas: P0-P3, WhatsApp+Push+SMS, ISA-18.2
- IA: Reactiva + Diagnóstica + Meteorológica (Open-Meteo)
- Cumplimiento: HACCP (CA), INVIMA/Dec1500/Res240 (CO), EN12830
- D1: 1 DB por org + KV con TTL 7d para telemetría cruda
- Trial: 30 días, 3 dispositivos, sin add-ons