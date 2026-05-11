# Phase 1 — DATA: Design Specification

**Date:** 2026-05-07
**Status:** Approved
**Phase:** 1 of 6 (DATA → IOT → AUTH → AI → BILLING → UI)

## 1. Architecture Decision: Hybrid D1 + KV

**Enfoque C elegido:** 1 D1 por organización (datos persistentes) + KV para telemetría cruda con TTL automático.

- D1-core: config, billing, alertas, rollups, cumplimiento, weather cache
- KV (TELEMETRY_RAW): lecturas crudas con TTL de 7 dias, auto-limpieza
- Cron Trigger cada hora: lee KV → calcula hourly_averages → escribe D1

**Por que no monolito D1:** Telemetria cruda comería el limite de 10GB. KV con TTL se auto-limpia.
**Por que no 2 D1s:** JOINs entre D1s requieren pasar datos por el Worker, complejidad innecesaria.

## 2. Roles

| Rol | Alcance | MFA | Permisos |
|-----|---------|-----|----------|
| admin_vilcami | Plataforma global | Si | Gestiona TODAS las orgs, planes, billing |
| admin | Organizacion | Si (obligatorio) | Gestiona su org, billing Wompi, invita usuarios, crea/elimina dispositivos |
| user | Organizacion | No | Controla dispositivos, define parametros, ve telemetria, reportes operativos |

Un usuario = una organizacion. Suspension > eliminacion (preservar auditoria).

## 3. Billing Model

Moneda base: COP, arquitectura multi-moneda (USD, CAD preparados en schema).
1 evento = 1 llamada API (Tuya o Modbus), no por sensor individual.

| Plan | COP/dispositivo/mes | Eventos incluidos | Overage (COP) |
|------|---------------------|-------------------|---------------|
| Starter | $8,500 | 720 (1/hora) | $8.50 cada 100 eventos |
| Professional | $14,900 | 7,200 (1 cada 5 min) | $4.25 cada 100 eventos |
| Enterprise | Desde $21,500 | Ilimitados | Incluido |

Add-ons Starter: IA Diagnostica (+$3,500), Reportes Cumplimiento (+$2,500), Escalamiento Avanzado (+$1,500).
Trial: 30 dias, 3 dispositivos, 1 lectura/hora, sin add-ons.

Precios en centavos (integers) para evitar errores de float.

## 4. Database Schema

### organizations
```
id                  TEXT PRIMARY KEY     -- UUID
name                TEXT NOT NULL         -- "Frigorificos del Norte SAS"
country_code        TEXT NOT NULL         -- ISO 3166-1 alpha-2 ("CO", "CA")
currency_code       TEXT NOT NULL         -- "COP", "USD", "CAD"
d1_database_id      TEXT NOT NULL         -- ID de la D1 instance de esta org
created_at          INTEGER NOT NULL      -- Unix timestamp
```

### organization_members
```
id                  TEXT PRIMARY KEY
organization_id     TEXT NOT NULL         -- FK organizations.id
supabase_user_id    TEXT NOT NULL         -- FK a Supabase Auth
role                TEXT NOT NULL         -- 'admin_vilcami' | 'admin' | 'user'
status              TEXT NOT NULL         -- 'active' | 'suspended'
invited_at          INTEGER              -- Unix timestamp
joined_at           INTEGER              -- Unix timestamp
suspended_at        INTEGER              -- Unix timestamp
suspended_reason    TEXT
```

### devices
```
id                  TEXT PRIMARY KEY
organization_id     TEXT NOT NULL         -- SIEMPRE filtrar por org
name                TEXT NOT NULL         -- "Camara Fria #3"
device_external_id  TEXT NOT NULL         -- ID en Tuya o Modbus
protocol_type       TEXT NOT NULL         -- 'tuya' | 'modbus'
location            TEXT                  -- "Planta Baja - Ala Oeste"
latitude            REAL
longitude           REAL
status              TEXT NOT NULL         -- 'online' | 'offline' | 'maintenance'
last_seen_at        INTEGER              -- Unix timestamp
created_at          INTEGER NOT NULL      -- Unix timestamp
```

### device_sensors
```
id                  TEXT PRIMARY KEY
device_id           TEXT NOT NULL         -- FK devices.id
sensor_type         TEXT NOT NULL         -- "temperatureExteriorCelsius"
unit                TEXT NOT NULL         -- "C", "%", "RPM"
min_threshold       REAL                  -- Umbral minimo para alertas
max_threshold       REAL                  -- Umbral maximo para alertas
is_alertable        INTEGER NOT NULL      -- boolean, default false
```

### alert_rules
```
id                      TEXT PRIMARY KEY
organization_id         TEXT NOT NULL
device_id               TEXT              -- FK devices.id
sensor_id               TEXT              -- FK device_sensors.id
rule_name               TEXT NOT NULL     -- "Temperatura alta camara 3"
severity                TEXT NOT NULL     -- 'p0' | 'p1' | 'p2' | 'p3'
condition_operator      TEXT NOT NULL     -- 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'between'
threshold_value         REAL NOT NULL
threshold_value_max     REAL              -- Para "between"
deadband_value           REAL NOT NULL     -- Histeresis, default 2.0 (regla Y2)
time_delay_seconds      INTEGER NOT NULL  -- Default 0
channels                TEXT NOT NULL     -- JSON: ["whatsapp", "push", "sms"]
enabled                 INTEGER NOT NULL  -- boolean, default true
maintenance_window_start INTEGER
maintenance_window_end   INTEGER
```

### alert_lifecycle
```
id                      TEXT PRIMARY KEY
organization_id         TEXT NOT NULL
alert_rule_id           TEXT NOT NULL     -- FK alert_rules.id
status                  TEXT NOT NULL     -- 'active' | 'acknowledged' | 'returned_to_normal' | 'shelved' | 'suppressed' | 'out_of_service'
triggered_at            INTEGER NOT NULL
acknowledged_at         INTEGER
acknowledged_by         TEXT              -- FK organization_members.id
returned_to_normal_at   INTEGER
shelved_until           INTEGER
suppression_reason      TEXT
out_of_service_approved_by TEXT
```

6 estados ISA-18.2: active → acknowledged → returned_to_normal, mas shelved (temporal con auto-retorno), suppressed (por logica de estado), out_of_service (requiere aprobacion).

### alert_escalations
```
id                      TEXT PRIMARY KEY
organization_id         TEXT NOT NULL
alert_lifecycle_id      TEXT NOT NULL     -- FK alert_lifecycle.id
escalated_to_member_id  TEXT NOT NULL
escalation_level        INTEGER NOT NULL  -- 1=primer nivel, 2=admin
channel                 TEXT NOT NULL     -- "whatsapp" | "push" | "sms"
sent_at                 INTEGER NOT NULL
acknowledged_at         INTEGER
```

### alert_audit_log
```
id                  TEXT PRIMARY KEY
organization_id     TEXT NOT NULL
alert_lifecycle_id  TEXT NOT NULL     -- FK alert_lifecycle.id
action              TEXT NOT NULL     -- "triggered" | "acknowledged" | "escalated" | "shelved" | "suppressed" | "returned_to_normal"
performed_by        TEXT              -- FK organization_members.id (null si sistema automatico)
timestamp           INTEGER NOT NULL
details             TEXT              -- JSON con contexto adicional
```

INMUTABLE: Solo INSERT, nunca UPDATE ni DELETE. Log de auditoria para HACCP/INVIMA.

### subscription_plans
```
id                                  TEXT PRIMARY KEY
name                                TEXT NOT NULL     -- "Starter" | "Professional" | "Enterprise"
currency_code                       TEXT NOT NULL     -- "COP" | "USD" | "CAD"
price_per_device_cents              INTEGER NOT NULL  -- En centavos
events_included                      INTEGER NOT NULL
overage_price_per_hundred_cents     INTEGER NOT NULL
features                            TEXT NOT NULL     -- JSON: {"ai_diagnostic": false, "compliance_reports": false, ...}
trial_days                          INTEGER NOT NULL  -- Default 30
max_trial_devices                   INTEGER NOT NULL  -- Default 3
is_trial_plan                       INTEGER NOT NULL  -- boolean
```

### device_subscriptions
```
id                      TEXT PRIMARY KEY
organization_id         TEXT NOT NULL
device_id               TEXT NOT NULL     -- FK devices.id
plan_id                 TEXT NOT NULL     -- FK subscription_plans.id
status                  TEXT NOT NULL     -- 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
trial_starts_at         INTEGER
trial_ends_at           INTEGER
current_period_start    INTEGER
current_period_end      INTEGER
add_ons                 TEXT              -- JSON: ["ai_diagnostic", "compliance_reports", "escalation_advanced"]
created_at              INTEGER NOT NULL
```

### billing_events
```
id                      TEXT PRIMARY KEY
organization_id         TEXT NOT NULL
device_subscription_id  TEXT NOT NULL     -- FK device_subscriptions.id
event_timestamp         INTEGER NOT NULL
event_type              TEXT NOT NULL     -- 'api_call_tuya' | 'api_call_modbus'
device_external_id      TEXT NOT NULL
sensor_count            INTEGER NOT NULL  -- Default 1, para analytics interno
```

### compliance_templates
```
id                  TEXT PRIMARY KEY
organization_id     TEXT NOT NULL
name                TEXT NOT NULL     -- "HACCP Colombia - Camaras frias"
regulation          TEXT NOT NULL     -- "HACCP" | "INVIMA_DEC1500" | "EN12830" | "CFIA_PREVENTIVE_CONTROLS"
country_code        TEXT NOT NULL     -- "CO" | "CA"
thresholds          TEXT NOT NULL     -- JSON con umbrales por normativa
report_schedule     TEXT NOT NULL     -- "daily" | "weekly" | "monthly"
enabled             INTEGER NOT NULL  -- boolean
```

### compliance_reports
```
id                  TEXT PRIMARY KEY
organization_id     TEXT NOT NULL
template_id         TEXT NOT NULL     -- FK compliance_templates.id
generated_at        INTEGER NOT NULL
period_start        INTEGER NOT NULL
period_end          INTEGER NOT NULL
report_type         TEXT NOT NULL     -- "haccp" | "invima" | "en12830" | "cfia"
status              TEXT NOT NULL     -- "generating" | "ready" | "sent" | "failed"
pdf_url             TEXT              -- URL en R2
data                TEXT              -- JSON con datos del reporte
```

### hourly_averages
```
id                  TEXT PRIMARY KEY
organization_id     TEXT NOT NULL
device_id           TEXT NOT NULL
sensor_id           TEXT NOT NULL
hour_bucket         INTEGER NOT NULL  -- Timestamp truncado a la hora
avg_value           REAL NOT NULL
min_value           REAL NOT NULL
max_value           REAL NOT NULL
sample_count        INTEGER NOT NULL
created_at          INTEGER NOT NULL
```

Retencion: 90 dias. Cron Trigger elimina registros > 90 dias.

### daily_summaries
```
id                  TEXT PRIMARY KEY
organization_id     TEXT NOT NULL
device_id           TEXT NOT NULL
sensor_id           TEXT NOT NULL
date_bucket         TEXT NOT NULL      -- "2026-05-07" formato ISO date
avg_value           REAL NOT NULL
min_value           REAL NOT NULL
max_value           REAL NOT NULL
std_dev             REAL
sample_count        INTEGER NOT NULL
alert_count         INTEGER NOT NULL  -- Default 0
created_at          INTEGER NOT NULL
```

Retencion: 2 anos. `std_dev` para deteccion de anomalias por IA.

### weather_cache
```
id                  TEXT PRIMARY KEY
organization_id     TEXT NOT NULL
latitude            REAL NOT NULL
longitude           REAL NOT NULL
temperature_celsius REAL
humidity_percent    REAL
wind_speed_kmh      REAL
weather_code        INTEGER           -- Open-Meteo weather code
fetched_at          INTEGER NOT NULL
expires_at          INTEGER NOT NULL  -- Cache TTL ~15 min
```

## 5. KV Namespace: TELEMETRY_RAW

```
Key format:   {orgId}:{deviceId}:{sensorId}:{timestamp}
Value format: { "value": number, "unit": string, "metadata": {} }
TTL:          7 dias (604800 segundos)
```

Lectura: KV para datos crudos recientes (< 7 dias).
Analisis: D1 para rollups (hourly_averages, daily_summaries).

## 6. Zod Validators

Todos los endpoints de ingesta de sensores, APIs y webhooks DEBEN validar con Zod.

### Esquemas principales:
- `telemetryValidator`: valida estructura de datos de telemetria entrante
- `deviceValidator`: valida creacion/actualizacion de dispositivos
- `alertRuleValidator`: valida reglas de alerta con umbrales y severidad
- `billingEventValidator`: valida conteo de eventos de billing
- `complianceReportValidator`: valida parametros de reportes de cumplimiento

Principio: Zod en toda entrada. Nunca confiar en datos sin validar.

## 7. KV Vault (AES-GCM)

Los Local Keys de Tuya, API keys y secrets se almacenan cifrados en KV usando `crypto.subtle` con AES-GCM.

```
KV Namespace: SECRETS_VAULT
Key format:   {orgId}:{secretType}:{secretId}
Value format: { "ciphertext": "...", "iv": "...", "tag": "..." }
```

Nunca en texto plano. Nunca en D1. Solo se descifra en el Worker en runtime.

## 8. Auth Stub (JWT Middleware)

Stub minimo para Fase 1 que permite que los endpoints funcionen con organizationId:

```typescript
// Middleware extrae del JWT:
// - sub: supabaseUserId
// - org_id: organizationId
// - role: 'admin_vilcami' | 'admin' | 'user'
// - mfa_verified: boolean (obligatorio para admin)
```

Reglas:
- Todo endpoint filtrar por organizationId del JWT
- Si role es 'admin' y mfa_verified es false → HTTP 403
- Si role es 'admin_vilcami' → puede ver todas las orgs

En Fase 3 se reemplaza por Supabase Auth completo.

## 9. Project Structure

```
vilcami/
├── src/
│   ├── schema/              # Drizzle schema definitions
│   │   ├── organizations.ts
│   │   ├── organization-members.ts
│   │   ├── devices.ts
│   │   ├── device-sensors.ts
│   │   ├── alert-rules.ts
│   │   ├── alert-lifecycle.ts
│   │   ├── alert-escalations.ts
│   │   ├── alert-audit-log.ts
│   │   ├── subscription-plans.ts
│   │   ├── device-subscriptions.ts
│   │   ├── billing-events.ts
│   │   ├── compliance-templates.ts
│   │   ├── compliance-reports.ts
│   │   ├── hourly-averages.ts
│   │   ├── daily-summaries.ts
│   │   ├── weather-cache.ts
│   │   └── index.ts
│   ├── validators/           # Zod schemas
│   │   ├── telemetry.validator.ts
│   │   ├── device.validator.ts
│   │   ├── alert.validator.ts
│   │   ├── billing.validator.ts
│   │   └── compliance.validator.ts
│   ├── services/
│   │   ├── telemetry-ingestion.service.ts
│   │   └── alert-evaluator.service.ts
│   ├── middleware/
│   │   └── jwt-stub.middleware.ts
│   ├── utils/
│   │   └── kv-vault.util.ts
│   └── index.ts
├── drizzle/
│   └── migrations/
├── wrangler.toml
├── drizzle.config.ts
├── package.json
└── tsconfig.json
```

## 10. Alert System Design

Severidades: P0 (critico), P1 (alto), P2 (medio), P3 (bajo).
Canales: WhatsApp (primario) + Push in-app (obligatorio) + SMS (fallback P0).
Escalamiento: P0 5min sin ack → admin, P1 15min sin ack → admin.
Anti-patrones: deadband/histeresis (regla Y2), time delay, correlacion de alarmas.

## 11. Compliance Targets

- Canada: Safe Food for Canadians Act, CFIA, HACCP
- Colombia: Decreto 1500/2007, Resolucion 240/2013, INVIMA
- International: EN12830
- Reportes: 1-click PDF audit-ready, logs inmutables con timestamp UTC

## 12. Weather Integration

Open-Meteo API: gratis, sin API key, Cloudflare tiene ejemplos oficiales.
Geolocalizacion automatica via request.cf.latitude/longitude.
Cache en D1 weather_cache con TTL ~15 minutos.
IA cruza datos meteorologicos con decisiones de dispositivos.

## 13. What is NOT in Phase 1

- No Tuya/Modbus integration (Phase 2)
- No Supabase Auth complete (Phase 3)
- No Workers AI integration (Phase 4)
- No Wompi integration (Phase 5)
- No React UI (Phase 6)
- No WhatsApp/Push/SMS notification sending (Phase 2+)
- No PDF report generation (Phase 4)