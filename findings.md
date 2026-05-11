# Findings — VILCAMI

## Skills Evaluadas

### Skills activas (recomendadas para uso)
- `planning-with-files` → Orquestación y persistencia de plan (esta skill)
- `tdd` → Ciclo red-green-refactor, vertical slices
- `typescript-advanced-types` → Tipado seguro para Drizzle y workers
- `superpowers:brainstorming` → Diseño antes de código
- `superpowers:writing-plans` → Planes de implementación detallados
- `superpowers:test-driven-development` → Wrapper formal TDD
- `superpowers:systematic-debugging` → Debugging estructurado

### Skills a ignorar o usar con cautela
- `domain-iot` → Orientada a Rust/embedded, no aplica a Cloudflare Workers TypeScript
- `vercel-react-best-practices` → Orientada a Next.js, no aplica a Vite SPA
- `scoutqa-test` → Solo útil en Fase 6 cuando haya UI deployada
- `firecrawl`, `seo-audit`, `agent-browser` → No relevantes para IoT industrial

## Decisiones de Arquitectura Pendientes
1. ¿Fase 3 (Auth) debe adelantarse como stub antes de Fase 2 (IoT)? Los workers IoT necesitan `organizationId`.
2. ¿Definir `DeviceAdapter` interface en Fase 1 o Fase 2? Recomendación: Fase 1 como contrato TypeScript.
3. ¿Esquema de rollup para Workers AI (Fase 4)? Necesita diseñarse en Fase 1 (tablas D1).

## Riesgos Identificados
| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Acoplamiento Auth ↔ IoT | Alto | Stub JWT desde Fase 1 |
| Tuya + Modbus sin abstracción | Alto | `DeviceAdapter` en Fase 1 |
| Workers AI sin memoria histórica | Medio | Tablas rollup en Fase 1 |
| Wompi webhook depende de D1 schema | Medio | Congelar schema organizations antes de Fase 5 |
