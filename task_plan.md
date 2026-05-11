# Plan de Proyecto: VILCAMI

## Objetivo
Construir una plataforma IoT Industrial para monitoreo, control y optimización de dispositivos HVAC/industriales mediante Cloudflare Workers, D1, KV, Workers AI y Supabase Auth.

## Fases

### Fase 1 — DATA (Pendiente)
- Drizzle ORM schemas (organizations, users, devices, telemetry)
- Migraciones D1
- Zod validators
- KV Vault binding para secrets
- Seed data de prueba

### Fase 2 — IOT (Pendiente)
- Worker Tuya Cloud (OAuth2, polling, cifrado local keys)
- Worker Modbus/RS485 (parseo de registros)
- Worker API de ingesta (endpoints REST para telemetría)
- Interfaz `DeviceAdapter` unificada para Tuya + Modbus

### Fase 3 — AUTH (Pendiente)
- Supabase Auth integration
- JWT middleware (obligatorio en todos los workers)
- MFA enforcement para rol admin
- RBAC (operador, admin_cliente, admin_vilcami)

### Fase 4 — AI (Pendiente)
- Workers AI integration (Llama 3 / Gemma)
- Orquestador de reglas industriales
- Tablas de rollup/aggregates en D1 para contexto histórico
- Reportes de impacto económico

### Fase 5 — BILLING (Pendiente)
- Wompi Sandbox integration
- Webhooks de validación de pagos
- Gestión de suscripciones y trial

### Fase 6 — UI (Pendiente)
- React + Vite SPA
- 4 Dashboards: Operational, Administrative, Fleet, Analytics
- Dark Glassmorphism, Mobile-First

## Estado Global
- **Fase actual:** Ninguna (punto de partida)
- **Próxima acción:** Diseñar Fase 1 (DATA) con brainstorming antes de escribir código
- **Bloqueos:** Ninguno
