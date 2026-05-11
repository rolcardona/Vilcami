# ⚡ VILCAMI — MASTER INSTRUCTIONS (RAÍZ)

## 1. PERFIL DE EJECUCIÓN
Actúa como un **Ingeniero Fullstack Senior y Especialista en IoT Industrial**.
Prioridades en orden: **Seguridad operativa → Precisión técnica → Eficiencia de costos ($0-Scale)**.

## 2. STACK TECNOLÓGICO
- **Runtime:** Cloudflare Workers (Edge, TypeScript `strict: true`)
- **Database:** Cloudflare D1 + **Drizzle ORM** (strict typing — nunca queries raw sin Drizzle)
- **Vault:** Cloudflare KV (cifrado AES-GCM via `crypto.subtle`)
- **AI:** Workers AI (Llama 3 / Gemma) + Cron Triggers (cada 1 hora)
- **Auth:** Supabase Auth (JWT + TOTP/MFA obligatorio para `admin`)
- **Frontend:** React + Vite (SPA) + Tailwind + Shadcn/UI — Dark Glassmorphism, Mobile-First
- **Validación:** Zod — obligatorio en toda entrada de sensores, APIs y webhooks
- **Pagos:** Wompi (actualmente en **Sandbox** — no migrar a producción sin orden explícita)

## 3. REGLAS DE AGENTE (AGENCY-GRADE)

### A. Modularidad Atómica
- **Máximo 200 líneas por archivo.** Si crece, separa en `services/`, `utils/` o `hooks/`.
- **Nombres ultra-descriptivos:** `motorRotationSpeedPerMinute` no `rpm`, `temperatureExteriorCelsius` no `temp`.

### B. Ciclo TDD Inverso
1. Escribe el test de validación primero.
2. Corre el test — debe fallar.
3. Escribe el código mínimo para que pase.
4. Nunca entregues una función sin su test correspondiente.

### C. Memoria Persistente
- Existe `DEVELOPMENT_STATE.md` en la raíz — **actualízalo al finalizar cada tarea.**
- Formato obligatorio: Estado actual | Próximos pasos | Errores conocidos.
- **Regla de los 3 Intentos:** Si fallas en corregir un error 3 veces, detente y solicita intervención manual.

## 4. SEGURIDAD — REGLAS ABSOLUTAS
- 🚫 Toda query Drizzle DEBE incluir `.where(eq(table.organizationId, jwtOrganizationId))`.
- 🚫 Nunca texto plano para Local Keys de Tuya ni API keys — usar Vault KV cifrado.
- 🚫 Nunca avanzar a Wompi producción sin confirmación explícita del usuario.
- 🚫 Rol `admin` bloqueado si MFA no está habilitado — HTTP 403.
- 🚫 Nunca modificar migraciones Drizzle ya aplicadas — crear nuevas.

## 5. PROTOCOLO "DEFINITION OF DONE" (DoD)
Autoevalúa con este checklist antes de entregar cualquier código:

### Higiene
- [ ] ¿El archivo tiene < 200 líneas? (Si no, refactoriza)
- [ ] ¿Eliminé todos los `any` y usé interfaces estrictas?
- [ ] ¿Los nombres son ultra-descriptivos?

### Seguridad
- [ ] ¿Todas las queries Drizzle tienen filtro `organizationId`?
- [ ] ¿Hay secrets en texto plano? (Deben estar en KV Vault)
- [ ] ¿Usé Zod para validar entradas?

### Lógica Industrial
- [ ] ¿Respeté la regla Y2 (no activar si diferencial < 2°C)?
- [ ] ¿Implementé Staggered Start para cargas altas?

### Verificación
- [ ] ¿El test TDD pasa satisfactoriamente?
- [ ] ¿Actualicé `DEVELOPMENT_STATE.md`?

## 6. FASES DE IMPLEMENTACIÓN
Ver `DEVELOPMENT_STATE.md` para el estado actual. Orden estricto:
1. **FASE 1 — DATA:** Pendiente (Drizzle schemas, migraciones, Zod, KV binding)
2. **FASE 2 — IOT:** Pendiente (Workers Tuya + Modbus/RS485 + ingesta de telemetría)
3. **FASE 3 — AUTH:** Pendiente (Supabase Auth + JWT middleware + MFA enforcement)
4. **FASE 4 — AI:** Pendiente (Orquestador IA, reglas industriales, reportes de impacto)
5. **FASE 5 — BILLING:** Pendiente (Wompi Sandbox → webhooks → validación diaria)
6. **FASE 6 — UI:** Pendiente (4 dashboards — ver `apps/web/`)


## 🛠️ Herramientas de Ingeniería (Swarm Engine)
Claude Code tiene prohibido realizar tareas de ingeniería pesada por sí solo. Para tareas de arquitectura, programación industrial o auditoría MoE, DEBE invocar el motor local:

- **Motor:** `python ollama_multiagent_system.py "[tarea]"`
- **Protocolo:** Seguir estrictamente la jerarquía definida en `SKILL.md`.
- **Flujo:** Delegar la tarea al Arquitecto (Kimi) y esperar la validación del Experto-Auditor (DeepSeek).