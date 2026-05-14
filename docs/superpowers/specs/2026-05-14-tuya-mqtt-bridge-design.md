# Puente MQTT Tuya → VILCAMI — Documento de Diseño

**Fecha:** 2026-05-14
**Stack:** Node.js + TypeScript + mqtt.js
**Despliegue:** Railway / Render (free tier, Node.js directo)

---

## 1. Propósito

VILCAMI necesita telemetría en tiempo real de 5 medidores eléctricos SmartLife
(3x PC321-W-TY, 2x PC341-W-TY-16). La API REST de Tuya no expone estos datos
(los endpoints /status devuelven vacío). La única vía es el servicio
**Device Status Notification** que opera sobre MQTT.

Este diseño describe un microservicio puente que:
- Se conecta al broker MQTT de Tuya
- Recibe datos en tiempo real de los 5 dispositivos
- Los convierte al formato de telemetría de VILCAMI
- Los envía al Worker existente vía REST

## 2. Arquitectura

```
Dispositivos SmartLife → Broker MQTT Tuya → servicio-puente → Worker VILCAMI → KV TELEMETRY_RAW → D1
                            (mqtts://...)    Node.js+TS       POST /ingest/bulk   (existente)
```

El Worker actual **no se modifica**, salvo agregar un middleware de API key para
autenticar las llamadas del puente.

El puente es un proceso Node.js estándar. Sin Docker, sin contenedores.
Railway/Render detectan `package.json` y ejecutan `npm start`.

## 3. Estructura de archivos

```
services/tuya-mqtt-bridge/
  src/
    index.ts          # entrypoint, orquesta todo
    mqtt-client.ts    # conexión MQTT, suscripción, heartbeat, reconexión
    credentials.ts    # llama a device.openHubConfig, rota cada 90 min
    mapper.ts         # convierte DP Tuya → formato telemetría VILCAMI
    ingester.ts       # buffer + POST al Worker
  .env.example
  package.json
  tsconfig.json
```

## 4. Gestión de credenciales MQTT

El servicio obtiene credenciales del broker MQTT mediante la API action-based de Tuya:

**Endpoint:** `device.openHubConfig`

**Parámetros:**
- `uid`: `az1745425389809oe2PF` (user ID de los dispositivos)
- `link_id`: `vilcami-bridge-v1`
- `link_type`: `mqtt`

**Respuesta relevante:**
- `url` — broker MQTT (ej. `mqtts://xxx:8883`)
- `username`, `password` — autenticación
- `client_id` — identificador del cliente
- `source_topic` — topic principal de suscripción
- `expire_time` — 7200 segundos (2 horas)

**Rotación:** Cada 90 minutos se refrescan las credenciales. Si `openHubConfig`
falla, se reintenta cada 30 segundos hasta 3 veces. Si agota reintentos,
se loguea error crítico y se sale (el process manager reinicia el servicio).

**Credenciales de la API Tuya** (accessKey/secretKey) se leen de variables de
entorno, nunca hardcodeadas. Las mismas que usa `list-tuya-devices.mjs`.

## 5. Conexión MQTT

**Librería:** `mqtt.js`

**Al iniciar:**
1. Obtiene credenciales vía `device.openHubConfig`
2. Conecta al broker con `url`, `username`, `password`, `client_id`
3. Se suscribe a:

```
tylink/eb95ed795ca1ff11dbkwkk/thing/property/report
tylink/eb4c657d9a27f2885fafab/thing/property/report
tylink/ebfb372b02246d14a8bs0z/thing/property/report
tylink/eb7a3bd0df31fb1b50ul92/thing/property/report
tylink/eb468050b02675d193an0i/thing/property/report
```

**Mantenimiento de conexión:**
- Heartbeat cada 60 segundos
- Si se pierde la conexión: backoff exponencial (1s → 2s → 4s → máx 60s)
- Cada 90 minutos: cierra y reconecta con credenciales frescas

## 6. Mapeo de datos

### Entrada (mensaje MQTT de Tuya)

```json
{
  "dataId": "123456",
  "devId": "eb95ed795ca1ff11dbkwkk",
  "productId": "gqmmtjclqb7reg5p",
  "status": [
    { "code": "101", "value": 2360 },
    { "code": "102", "value": 1282 },
    { "code": "103", "value": -140 },
    { "code": "104", "value": 46 },
    { "code": "106", "value": 38006 },
    { "code": "107", "value": 2342 },
    { "code": "111", "value": 2398 },
    { "code": "112", "value": 1416 },
    { "code": "113", "value": -317 },
    { "code": "114", "value": 94 },
    { "code": "116", "value": 33758 },
    { "code": "117", "value": 2504 },
    { "code": "121", "value": 2376 },
    { "code": "122", "value": 1099 },
    { "code": "123", "value": -24 },
    { "code": "124", "value": 12 },
    { "code": "126", "value": 34656 },
    { "code": "127", "value": 1621 },
    { "code": "131", "value": 106421 },
    { "code": "132", "value": 3797 },
    { "code": "133", "value": -484 },
    { "code": "135", "value": 50 },
    { "code": "136", "value": 101 },
    { "code": "137", "value": 14 },
    { "code": "139", "value": 6469 }
  ]
}
```

### Salida (formato VILCAMI)

```json
[
  {
    "deviceId": "eb95ed795ca1ff11dbkwkk",
    "sensorId": "101",
    "value": 236.0,
    "unit": "V",
    "timestamp": 1778735400000,
    "metadata": { "code": "VoltageA", "raw": 2360 }
  },
  {
    "deviceId": "eb95ed795ca1ff11dbkwkk",
    "sensorId": "102",
    "value": 1.282,
    "unit": "A",
    "timestamp": 1778735400000,
    "metadata": { "code": "CurrentA", "raw": 1282 }
  }
]
```

### Diccionario de escalas

Se incluye un mapa fijo con factor de división + unidad por DP, basado en la
documentación oficial de Tuya para PC321-W-TY y PC341-W-TY-16.

| DP | Factor | Unidad | Descripción |
|----|--------|--------|-------------|
| 101, 111, 121 | ÷1 | V | Voltage (fase A/B/C) |
| 102, 112, 122 | ÷1000 | A | Current (fase A/B/C) |
| 103, 113, 123 | ÷1000 | kW | Active Power (fase A/B/C) |
| 104, 114, 124 | ÷100 | — | Power Factor (fase A/B/C) |
| 106, 116, 126 | ÷100 | kWh | Energy Consumed (fase A/B/C) |
| 107, 117, 127 | ÷100 | kWh | Reverse Energy (fase A/B/C) |
| 131 | ÷100 | kWh | Total Energy Consumed |
| 132 | ÷1000 | A | Total Current |
| 133 | ÷1000 | kW | Total Active Power |
| 135 | ÷1 | Hz | Frequency |
| 136 | ÷1 | °C | Device Temperature |
| 139 | ÷100 | kWh | Total Reverse Energy |

DPs desconocidos se ignoran sin romper el flujo.

## 7. Envío al Worker

**Buffer:** Acumula lecturas durante 10 segundos (máx 200 lecturas).
Si se llena antes, se envía inmediatamente.

**POST** a `{VILCAMI_INGEST_URL}/api/telemetry/ingest/bulk`:
```
Authorization: Bearer <VILCAMI_API_KEY>
Content-Type: application/json
```

**Reintentos:** Hasta 3 veces con backoff exponencial. Si falla después de 3,
se loguea el error y se descarta el batch.

### Middleware de API Key en el Worker

Se agrega un middleware `apiKeyAuth` al endpoint `/api/telemetry/ingest/bulk`
que valida `Authorization: Bearer <key>` contra una clave configurada en
variables de entorno del Worker (`INTERNAL_API_KEY`). Si no coincide → 401.

## 8. Configuración

### Variables de entorno del puente

| Variable | Descripción | Ejemplo |
|---|---|---|
| `TUYA_BASE_URL` | Datacenter Tuya | `https://openapi.tuyaus.com` |
| `TUYA_ACCESS_KEY` | Access ID del proyecto | `gd9jsn3yhkqj7wfvmenq` |
| `TUYA_SECRET_KEY` | Access Secret | `13c42...` |
| `TUYA_UID` | User ID de SmartLife | `az1745425389809oe2PF` |
| `TUYA_DEVICE_IDS` | IDs separados por coma | `eb95...,eb4c...,...` |
| `VILCAMI_INGEST_URL` | URL base del Worker | `https://vilcami-worker.<subdomain>.workers.dev` |
| `VILCAMI_API_KEY` | API key interna | (generar) |

### Variable de entorno nueva en el Worker

| Variable | Descripción |
|---|---|
| `INTERNAL_API_KEY` | Misma clave que `VILCAMI_API_KEY` del puente |

## 9. Despliegue

- **Plataforma:** Railway / Render (free tier)
- **Runtime:** Node.js ≥ 20
- **Start command:** `npm start` → `tsx src/index.ts`
- Sin Docker, sin build step complejo

## 10. Manejo de errores

| Escenario | Respuesta |
|---|---|
| `openHubConfig` falla | Reintenta 3 veces, si no → loguea crítico y sale |
| Conexión MQTT cae | Reconexión automática con backoff |
| Credenciales expiran | Rotación proactiva cada 90 min |
| POST al Worker falla | 3 reintentos con backoff, luego descarta batch |
| DP desconocido | Se ignora, sigue con el resto |
| Mensaje MQTT malformado | Se loguea warning, se descarta |
| Servicio se cae | Railway/Render lo reinicia automáticamente |
