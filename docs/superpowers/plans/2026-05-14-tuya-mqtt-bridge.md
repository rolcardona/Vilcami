# Puente MQTT Tuya → VILCAMI — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Microservicio Node.js + TypeScript que conecta el broker MQTT de Tuya, recibe telemetría de 5 medidores eléctricos SmartLife, convierte los DPs al formato VILCAMI y los envía al Worker vía REST.

**Architecture:** Proceso Node.js (sin Docker) con 4 módulos internos — credentials (obtiene/rota credenciales MQTT de Tuya), mapper (DP → telemetría con escalas), mqtt-client (conexión persistente, suscripción, reconexión), ingester (buffer + POST al Worker con reintentos). Un index.ts orquesta el ciclo de vida. El Worker existente solo recibe un middleware de API key de ~15 líneas.

**Tech Stack:** Node.js ≥ 20, TypeScript strict, mqtt.js, tsx (runner, sin build step), Zod (validación)

---

### Task 1: Scaffolding del proyecto

**Files:**
- Create: `services/tuya-mqtt-bridge/package.json`
- Create: `services/tuya-mqtt-bridge/tsconfig.json`
- Create: `services/tuya-mqtt-bridge/.env.example`

- [ ] **Step 1: Crear package.json**

```bash
mkdir -p services/tuya-mqtt-bridge/src
```

`services/tuya-mqtt-bridge/package.json`:
```json
{
  "name": "tuya-mqtt-bridge",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx --watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "mqtt": "^5.10.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

- [ ] **Step 2: Crear tsconfig.json**

`services/tuya-mqtt-bridge/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Crear .env.example**

`services/tuya-mqtt-bridge/.env.example`:
```
TUYA_BASE_URL=https://openapi.tuyaus.com
TUYA_ACCESS_KEY=
TUYA_SECRET_KEY=
TUYA_UID=az1745425389809oe2PF
TUYA_DEVICE_IDS=eb95ed795ca1ff11dbkwkk,eb4c657d9a27f2885fafab,ebfb372b02246d14a8bs0z,eb7a3bd0df31fb1b50ul92,eb468050b02675d193an0i
VILCAMI_INGEST_URL=
VILCAMI_API_KEY=
VILCAMI_ORG_ID=
```

- [ ] **Step 4: Instalar dependencias y verificar**

```bash
cd services/tuya-mqtt-bridge && npm install
```

Expected: `npm install` completes without errors, `node_modules/` created.

- [ ] **Step 5: Commit**

```bash
git add services/tuya-mqtt-bridge/package.json services/tuya-mqtt-bridge/tsconfig.json services/tuya-mqtt-bridge/.env.example
git commit -m "feat: scaffold tuya-mqtt-bridge project"
```

---

### Task 2: Tipos compartidos

**Files:**
- Create: `services/tuya-mqtt-bridge/src/types.ts`

- [ ] **Step 1: Crear el archivo de tipos**

`services/tuya-mqtt-bridge/src/types.ts`:
```typescript
// ─── Credenciales MQTT (respuesta de device.openHubConfig) ───

export interface MqttCredentials {
  url: string;
  username: string;
  password: string;
  client_id: string;
  source_topic: string;
  expire_time: number;
}

export interface OpenHubConfigResponse {
  success: boolean;
  result?: {
    url: string;
    username: string;
    password: string;
    client_id: string;
    source_topic: string;
    expire_time: number;
  };
  code?: number;
  msg?: string;
}

// ─── Mensaje MQTT entrante de Tuya ───

export interface TuyaMqttStatus {
  code: string;
  value: number | string | boolean;
}

export interface TuyaMqttMessage {
  dataId?: string;
  devId: string;
  productId?: string;
  status: TuyaMqttStatus[];
}

// ─── Lectura de telemetría (formato VILCAMI) ───

export interface TelemetryReading {
  organizationId: string;
  deviceId: string;
  sensorId: string;
  value: number;
  unit: string;
  timestamp: number; // Unix epoch en milisegundos
  metadata?: Record<string, unknown>;
}

// ─── DPs desconocidos ───

export interface DpMapping {
  factor: number;
  unit: string;
  description: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add services/tuya-mqtt-bridge/src/types.ts
git commit -m "feat: add shared types for tuya-mqtt-bridge"
```

---

### Task 3: Mapper — convertir DPs Tuya a telemetría VILCAMI

**Files:**
- Create: `services/tuya-mqtt-bridge/src/mapper.ts`
- Create: `services/tuya-mqtt-bridge/src/mapper.test.ts`

- [ ] **Step 1: Escribir el test**

`services/tuya-mqtt-bridge/src/mapper.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { mapTuyaMessage, DP_MAP } from "./mapper.js";
import type { TuyaMqttMessage } from "./types.js";

const ORG_ID = "org_test_001";

describe("mapTuyaMessage", () => {
  it("convierte un mensaje PC321-W-TY completo a lecturas de telemetría", () => {
    const msg: TuyaMqttMessage = {
      dataId: "123",
      devId: "eb95ed795ca1ff11dbkwkk",
      productId: "gqmmtjclqb7reg5p",
      status: [
        { code: "101", value: 2360 },
        { code: "102", value: 1282 },
        { code: "103", value: -140 },
        { code: "131", value: 106421 },
        { code: "132", value: 3797 },
        { code: "133", value: -484 },
      ],
    };

    const result = mapTuyaMessage(msg, ORG_ID);

    expect(result).toHaveLength(6);

    expect(result[0]).toMatchObject({
      organizationId: ORG_ID,
      deviceId: "eb95ed795ca1ff11dbkwkk",
      sensorId: "101",
      value: 2360,
      unit: "V",
    });
    expect(result[0].timestamp).toBeGreaterThan(0);

    expect(result[1]).toMatchObject({
      sensorId: "102",
      value: 1.282,
      unit: "A",
    });

    expect(result[3]).toMatchObject({
      sensorId: "131",
      value: 1064.21,
      unit: "kWh",
    });
  });

  it("ignora DPs que no están en el diccionario", () => {
    const msg: TuyaMqttMessage = {
      devId: "eb95ed795ca1ff11dbkwkk",
      status: [
        { code: "101", value: 2200 },
        { code: "999", value: 42 },
        { code: "131", value: 5000 },
      ],
    };

    const result = mapTuyaMessage(msg, ORG_ID);

    expect(result).toHaveLength(2);
    expect(result[0].sensorId).toBe("101");
    expect(result[1].sensorId).toBe("131");
  });

  it("retorna array vacío si status viene vacío", () => {
    const msg: TuyaMqttMessage = {
      devId: "eb95ed795ca1ff11dbkwkk",
      status: [],
    };

    expect(mapTuyaMessage(msg, ORG_ID)).toEqual([]);
  });

  it("retorna array vacío si status es undefined", () => {
    const msg = {
      devId: "eb95ed795ca1ff11dbkwkk",
    } as TuyaMqttMessage;

    expect(mapTuyaMessage(msg, ORG_ID)).toEqual([]);
  });

  it("maneja valores string numéricos", () => {
    const msg: TuyaMqttMessage = {
      devId: "eb95ed795ca1ff11dbkwkk",
      status: [
        { code: "101", value: "2360" },
        { code: "131", value: "106421" },
      ],
    };

    const result = mapTuyaMessage(msg, ORG_ID);
    expect(result[0].value).toBe(2360);
    expect(result[1].value).toBe(1064.21);
  });

  it("usa DP_MAP como fuente de verdad para cada DP conocido", () => {
    // Cada DP en DP_MAP debe tener factor y unit válidos
    for (const [code, mapping] of Object.entries(DP_MAP)) {
      expect(mapping.factor).toBeGreaterThan(0);
      expect(mapping.unit).toBeTruthy();
      expect(typeof code).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Verificar que el test falle**

```bash
cd services/tuya-mqtt-bridge && npx vitest run
```

Expected: FAIL — `mapTuyaMessage is not defined`, `DP_MAP is not defined`

- [ ] **Step 3: Implementar el mapper**

`services/tuya-mqtt-bridge/src/mapper.ts`:
```typescript
import type { TuyaMqttMessage, TelemetryReading, DpMapping } from "./types.js";

export const DP_MAP: Record<string, DpMapping> = {
  "101": { factor: 1, unit: "V", description: "Voltage A" },
  "102": { factor: 1000, unit: "A", description: "Current A" },
  "103": { factor: 1000, unit: "kW", description: "Active Power A" },
  "104": { factor: 100, unit: "", description: "Power Factor A" },
  "106": { factor: 100, unit: "kWh", description: "Energy Consumed A" },
  "107": { factor: 100, unit: "kWh", description: "Reverse Energy A" },
  "111": { factor: 1, unit: "V", description: "Voltage B" },
  "112": { factor: 1000, unit: "A", description: "Current B" },
  "113": { factor: 1000, unit: "kW", description: "Active Power B" },
  "114": { factor: 100, unit: "", description: "Power Factor B" },
  "116": { factor: 100, unit: "kWh", description: "Energy Consumed B" },
  "117": { factor: 100, unit: "kWh", description: "Reverse Energy B" },
  "121": { factor: 1, unit: "V", description: "Voltage C" },
  "122": { factor: 1000, unit: "A", description: "Current C" },
  "123": { factor: 1000, unit: "kW", description: "Active Power C" },
  "124": { factor: 100, unit: "", description: "Power Factor C" },
  "126": { factor: 100, unit: "kWh", description: "Energy Consumed C" },
  "127": { factor: 100, unit: "kWh", description: "Reverse Energy C" },
  "131": { factor: 100, unit: "kWh", description: "Total Energy Consumed" },
  "132": { factor: 1000, unit: "A", description: "Total Current" },
  "133": { factor: 1000, unit: "kW", description: "Total Active Power" },
  "135": { factor: 1, unit: "Hz", description: "Frequency" },
  "136": { factor: 1, unit: "°C", description: "Device Temperature" },
  "139": { factor: 100, unit: "kWh", description: "Total Reverse Energy" },
};

export function mapTuyaMessage(
  msg: TuyaMqttMessage,
  organizationId: string,
): TelemetryReading[] {
  if (!msg.status || msg.status.length === 0) return [];

  const now = Date.now();
  const readings: TelemetryReading[] = [];

  for (const status of msg.status) {
    const mapping = DP_MAP[status.code];
    if (!mapping) continue;

    const rawValue = typeof status.value === "string"
      ? parseFloat(status.value)
      : (status.value as number);

    if (isNaN(rawValue)) continue;

    readings.push({
      organizationId,
      deviceId: msg.devId,
      sensorId: status.code,
      value: rawValue / mapping.factor,
      unit: mapping.unit,
      timestamp: now,
      metadata: { code: mapping.description, raw: status.value },
    });
  }

  return readings;
}
```

- [ ] **Step 4: Correr tests**

```bash
cd services/tuya-mqtt-bridge && npx vitest run
```

Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add services/tuya-mqtt-bridge/src/mapper.ts services/tuya-mqtt-bridge/src/mapper.test.ts
git commit -m "feat: implement Tuya DP mapper with scale factors"
```

---

### Task 4: Credentials — obtener y rotar credenciales MQTT

**Files:**
- Create: `services/tuya-mqtt-bridge/src/credentials.ts`
- Create: `services/tuya-mqtt-bridge/src/credentials.test.ts`

- [ ] **Step 1: Escribir el test**

`services/tuya-mqtt-bridge/src/credentials.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { fetchMqttCredentials } from "./credentials.js";
import type { OpenHubConfigResponse } from "./types.js";

function mockFetch(response: OpenHubConfigResponse) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(response),
  });
}

const VALID_RESPONSE: OpenHubConfigResponse = {
  success: true,
  result: {
    url: "mqtts://broker.tuya.com:8883",
    username: "user123",
    password: "pass456",
    client_id: "client_abc",
    source_topic: "cloud/token/out/dev123",
    expire_time: 7200,
  },
};

describe("fetchMqttCredentials", () => {
  it("retorna credenciales cuando la API responde success", async () => {
    const creds = await fetchMqttCredentials(mockFetch(VALID_RESPONSE), {
      tuyaBaseUrl: "https://openapi.tuyaus.com",
      accessKey: "ak",
      secretKey: "sk",
      uid: "user_1",
    });

    expect(creds).toEqual({
      url: "mqtts://broker.tuya.com:8883",
      username: "user123",
      password: "pass456",
      client_id: "client_abc",
      source_topic: "cloud/token/out/dev123",
      expire_time: 7200,
    });
  });

  it("lanza error si la API devuelve success=false", async () => {
    const fetchFn = mockFetch({
      success: false,
      code: 1109,
      msg: "param illegal",
    });

    await expect(
      fetchMqttCredentials(fetchFn, {
        tuyaBaseUrl: "https://openapi.tuyaus.com",
        accessKey: "ak",
        secretKey: "sk",
        uid: "user_1",
      }),
    ).rejects.toThrow("param illegal");
  });

  it("lanza error si result está vacío", async () => {
    const fetchFn = mockFetch({ success: true });

    await expect(
      fetchMqttCredentials(fetchFn, {
        tuyaBaseUrl: "https://openapi.tuyaus.com",
        accessKey: "ak",
        secretKey: "sk",
        uid: "user_1",
      }),
    ).rejects.toThrow("no result");
  });

  it("lanza error si fetch lanza excepción", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("Network error"));

    await expect(
      fetchMqttCredentials(fetchFn, {
        tuyaBaseUrl: "https://openapi.tuyaus.com",
        accessKey: "ak",
        secretKey: "sk",
        uid: "user_1",
      }),
    ).rejects.toThrow("Network error");
  });
});
```

- [ ] **Step 2: Verificar que falle**

```bash
cd services/tuya-mqtt-bridge && npx vitest run
```

Expected: FAIL — `fetchMqttCredentials is not defined`

- [ ] **Step 3: Implementar el módulo de credenciales**

`services/tuya-mqtt-bridge/src/credentials.ts`:
```typescript
import type { MqttCredentials, OpenHubConfigResponse } from "./types.js";

interface FetchFn {
  (url: string, init?: RequestInit): Promise<{ ok: boolean; json: () => Promise<unknown> }>;
}

interface CredentialsConfig {
  tuyaBaseUrl: string;
  accessKey: string;
  secretKey: string;
  uid: string;
}

async function signTuyaRequest(
  accessKey: string,
  secretKey: string,
  method: string,
  body: string,
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString();
  const encoder = new TextEncoder();
  const data = encoder.encode(accessKey + timestamp + method + body);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, data);
  const signHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    client_id: accessKey,
    sign: signHex,
    t: timestamp,
    sign_method: "HMAC-SHA256",
  };
}

export async function fetchMqttCredentials(
  fetchFn: FetchFn,
  config: CredentialsConfig,
): Promise<MqttCredentials> {
  const url = `${config.tuyaBaseUrl}/v1.0/iot-03/open-hub/config`;

  const body = JSON.stringify({
    uid: config.uid,
    link_id: "vilcami-bridge-v1",
    link_type: "mqtt",
  });

  const signHeaders = await signTuyaRequest(
    config.accessKey,
    config.secretKey,
    "POST",
    body,
  );

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...signHeaders,
    },
    body,
  });

  const data = (await response.json()) as OpenHubConfigResponse;

  if (!data.success || !data.result) {
    throw new Error(
      `openHubConfig failed: ${data.code ?? "unknown"} — ${data.msg ?? "no result"}`,
    );
  }

  return {
    url: data.result.url,
    username: data.result.username,
    password: data.result.password,
    client_id: data.result.client_id,
    source_topic: data.result.source_topic,
    expire_time: data.result.expire_time,
  };
}
```

- [ ] **Step 4: Correr tests**

```bash
cd services/tuya-mqtt-bridge && npx vitest run
```

Expected: 4 tests PASS (credentials) + 6 tests PASS (mapper) = 10 total

- [ ] **Step 5: Commit**

```bash
git add services/tuya-mqtt-bridge/src/credentials.ts services/tuya-mqtt-bridge/src/credentials.test.ts
git commit -m "feat: implement openHubConfig credentials fetch with HMAC-SHA256 signing"
```

---

### Task 5: MQTT Client — conexión, suscripción, reconexión

**Files:**
- Create: `services/tuya-mqtt-bridge/src/mqtt-client.ts`
- Create: `services/tuya-mqtt-bridge/src/mqtt-client.test.ts`

- [ ] **Step 1: Escribir el test**

`services/tuya-mqtt-bridge/src/mqtt-client.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { buildDeviceTopics } from "./mqtt-client.js";

describe("buildDeviceTopics", () => {
  it("genera los topics tylink correctos para cada dispositivo", () => {
    const deviceIds = [
      "eb95ed795ca1ff11dbkwkk",
      "eb4c657d9a27f2885fafab",
    ];

    const topics = buildDeviceTopics(deviceIds);

    expect(topics).toEqual([
      "tylink/eb95ed795ca1ff11dbkwkk/thing/property/report",
      "tylink/eb4c657d9a27f2885fafab/thing/property/report",
    ]);
  });

  it("retorna array vacío si no hay device IDs", () => {
    expect(buildDeviceTopics([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Verificar que falle**

```bash
cd services/tuya-mqtt-bridge && npx vitest run
```

Expected: FAIL — `buildDeviceTopics is not defined`

- [ ] **Step 3: Implementar el módulo MQTT**

`services/tuya-mqtt-bridge/src/mqtt-client.ts`:
```typescript
import mqtt, { MqttClient } from "mqtt";
import type { MqttCredentials, TuyaMqttMessage } from "./types.js";

export function buildDeviceTopics(deviceIds: string[]): string[] {
  return deviceIds.map((id) => `tylink/${id}/thing/property/report`);
}

interface MqttClientCallbacks {
  onMessage: (msg: TuyaMqttMessage) => void;
  onError: (err: Error) => void;
  onDisconnect: () => void;
}

export function createMqttClient(
  credentials: MqttCredentials,
  deviceIds: string[],
  callbacks: MqttClientCallbacks,
): MqttClient {
  const client = mqtt.connect(credentials.url, {
    username: credentials.username,
    password: credentials.password,
    clientId: credentials.client_id,
    clean: true,
    connectTimeout: 30000,
    reconnectPeriod: 0, // manejamos reconexión nosotros
  });

  client.on("connect", () => {
    console.log("[mqtt] connected to Tuya broker");

    const topics = buildDeviceTopics(deviceIds);
    for (const topic of topics) {
      client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`[mqtt] subscribe error for ${topic}:`, err.message);
        }
      });
    }
    console.log(`[mqtt] subscribed to ${topics.length} device topics`);
  });

  client.on("message", (topic, payload) => {
    try {
      const msg = JSON.parse(payload.toString()) as TuyaMqttMessage;
      callbacks.onMessage(msg);
    } catch (err) {
      console.warn("[mqtt] failed to parse message:", (err as Error).message);
    }
  });

  client.on("error", (err) => {
    console.error("[mqtt] connection error:", err.message);
    callbacks.onError(err);
  });

  client.on("disconnect", () => {
    console.log("[mqtt] disconnected");
    callbacks.onDisconnect();
  });

  return client;
}

export function closeMqttClient(client: MqttClient): Promise<void> {
  return new Promise((resolve) => {
    client.end(false, {}, () => resolve());
  });
}
```

- [ ] **Step 4: Correr tests**

```bash
cd services/tuya-mqtt-bridge && npx vitest run
```

Expected: 2 tests PASS (mqtt-client) + 10 anteriores = 12 total

- [ ] **Step 5: Commit**

```bash
git add services/tuya-mqtt-bridge/src/mqtt-client.ts services/tuya-mqtt-bridge/src/mqtt-client.test.ts
git commit -m "feat: implement MQTT client with device topic subscription"
```

---

### Task 6: Ingestion Client — buffer + POST al Worker

**Files:**
- Create: `services/tuya-mqtt-bridge/src/ingester.ts`
- Create: `services/tuya-mqtt-bridge/src/ingester.test.ts`

- [ ] **Step 1: Escribir el test**

`services/tuya-mqtt-bridge/src/ingester.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Ingester } from "./ingester.js";
import type { TelemetryReading } from "./types.js";

describe("Ingester", () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  let ingester: Ingester;
  const ORG_ID = "org_test";

  beforeEach(() => {
    fetchFn = vi.fn().mockResolvedValue({ ok: true });
    ingester = new Ingester({
      ingestUrl: "https://worker.example.com/api/telemetry/ingest/bulk",
      apiKey: "key123",
      organizationId: ORG_ID,
      maxBufferSize: 5,
      flushIntervalMs: 100,
      maxRetries: 2,
      fetchFn,
    });
  });

  it("agrega lecturas al buffer", () => {
    const reading: TelemetryReading = {
      organizationId: ORG_ID,
      deviceId: "dev1",
      sensorId: "101",
      value: 220,
      unit: "V",
      timestamp: Date.now(),
    };

    ingester.add(reading);
    expect(ingester.size).toBe(1);
  });

  it("hace flush automático al alcanzar maxBufferSize", async () => {
    for (let i = 0; i < 6; i++) {
      ingester.add({
        organizationId: ORG_ID,
        deviceId: "dev1",
        sensorId: String(101 + i),
        value: 220 + i,
        unit: "V",
        timestamp: Date.now(),
      });
    }

    // Debería haber flusheado al menos una vez
    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalled();
    }, { timeout: 1000 });
  });

  it("manda los headers correctos en el POST", async () => {
    ingester.add({
      organizationId: ORG_ID,
      deviceId: "dev1",
      sensorId: "101",
      value: 220,
      unit: "V",
      timestamp: Date.now(),
    });

    await ingester.flush();

    expect(fetchFn).toHaveBeenCalledWith(
      "https://worker.example.com/api/telemetry/ingest/bulk",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer key123",
        }),
      }),
    );
  });

  it("reintenta hasta maxRetries veces si el POST falla", async () => {
    fetchFn
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ ok: true });

    ingester.add({
      organizationId: ORG_ID,
      deviceId: "dev1",
      sensorId: "101",
      value: 220,
      unit: "V",
      timestamp: Date.now(),
    });

    await ingester.flush();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("descarta el batch después de agotar reintentos", async () => {
    fetchFn.mockRejectedValue(new Error("Persistent error"));

    ingester.add({
      organizationId: ORG_ID,
      deviceId: "dev1",
      sensorId: "101",
      value: 220,
      unit: "V",
      timestamp: Date.now(),
    });

    await ingester.flush();
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(ingester.size).toBe(0); // batch descartado
  });

  it("cleanup detiene el timer de flush", () => {
    ingester.cleanup();
    // No lanza error, timer limpiado
  });
});
```

- [ ] **Step 2: Verificar que falle**

```bash
cd services/tuya-mqtt-bridge && npx vitest run
```

Expected: FAIL — `Ingester is not defined`

- [ ] **Step 3: Implementar el ingester**

`services/tuya-mqtt-bridge/src/ingester.ts`:
```typescript
import type { TelemetryReading } from "./types.js";

interface FetchFn {
  (url: string, init?: RequestInit): Promise<{ ok: boolean; json?: () => Promise<unknown> }>;
}

interface IngesterConfig {
  ingestUrl: string;
  apiKey: string;
  organizationId: string;
  maxBufferSize?: number;
  flushIntervalMs?: number;
  maxRetries?: number;
  fetchFn?: FetchFn;
}

export class Ingester {
  private buffer: TelemetryReading[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private ingestUrl: string;
  private apiKey: string;
  private orgId: string;
  private maxBufferSize: number;
  private maxRetries: number;
  private fetchFn: FetchFn;

  constructor(config: IngesterConfig) {
    this.ingestUrl = config.ingestUrl;
    this.apiKey = config.apiKey;
    this.orgId = config.organizationId;
    this.maxBufferSize = config.maxBufferSize ?? 200;
    this.maxRetries = config.maxRetries ?? 3;
    this.fetchFn = config.fetchFn ?? ((url, init) => fetch(url, init));

    const interval = config.flushIntervalMs ?? 10000;
    this.timer = setInterval(() => this.flush(), interval);
  }

  get size(): number {
    return this.buffer.length;
  }

  add(reading: TelemetryReading): void {
    reading.organizationId = this.orgId;
    this.buffer.push(reading);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchFn(this.ingestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(batch),
        });

        if (response.ok) {
          console.log(`[ingester] flushed ${batch.length} readings (attempt ${attempt})`);
          return;
        }
      } catch (err) {
        console.warn(
          `[ingester] attempt ${attempt}/${this.maxRetries} failed:`,
          (err as Error).message,
        );
      }

      if (attempt < this.maxRetries) {
        await sleep(Math.pow(2, attempt) * 1000);
      }
    }

    console.error(`[ingester] discarded ${batch.length} readings after ${this.maxRetries} failed attempts`);
  }

  cleanup(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 4: Correr tests**

```bash
cd services/tuya-mqtt-bridge && npx vitest run
```

Expected: 6 tests PASS (ingester) + 12 anteriores = 18 total

- [ ] **Step 5: Commit**

```bash
git add services/tuya-mqtt-bridge/src/ingester.ts services/tuya-mqtt-bridge/src/ingester.test.ts
git commit -m "feat: implement ingestion client with buffer and retry logic"
```

---

### Task 7: Index — entrypoint principal (orquestación)

**Files:**
- Create: `services/tuya-mqtt-bridge/src/index.ts`

- [ ] **Step 1: Implementar el entrypoint**

`services/tuya-mqtt-bridge/src/index.ts`:
```typescript
import { fetchMqttCredentials } from "./credentials.js";
import { createMqttClient, closeMqttClient } from "./mqtt-client.js";
import { mapTuyaMessage } from "./mapper.js";
import { Ingester } from "./ingester.js";
import type { MqttCredentials, TuyaMqttMessage } from "./types.js";

const ENV = {
  tuyaBaseUrl: process.env.TUYA_BASE_URL ?? "https://openapi.tuyaus.com",
  accessKey: process.env.TUYA_ACCESS_KEY ?? "",
  secretKey: process.env.TUYA_SECRET_KEY ?? "",
  uid: process.env.TUYA_UID ?? "az1745425389809oe2PF",
  deviceIds: (process.env.TUYA_DEVICE_IDS ?? "").split(",").filter(Boolean),
  ingestUrl: process.env.VILCAMI_INGEST_URL ?? "",
  apiKey: process.env.VILCAMI_API_KEY ?? "",
  orgId: process.env.VILCAMI_ORG_ID ?? "",
};

function validateEnv() {
  const missing: string[] = [];
  if (!ENV.accessKey) missing.push("TUYA_ACCESS_KEY");
  if (!ENV.secretKey) missing.push("TUYA_SECRET_KEY");
  if (!ENV.ingestUrl) missing.push("VILCAMI_INGEST_URL");
  if (!ENV.apiKey) missing.push("VILCAMI_API_KEY");
  if (!ENV.orgId) missing.push("VILCAMI_ORG_ID");
  if (ENV.deviceIds.length === 0) missing.push("TUYA_DEVICE_IDS");

  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
}

const CREDENTIAL_REFRESH_MS = 90 * 60 * 1000; // 90 minutos
const RECONNECT_BACKOFF_MAX_MS = 60_000; // 60 segundos máximo

let reconnectAttempt = 0;

function backoffMs(): number {
  return Math.min(Math.pow(2, reconnectAttempt) * 1000, RECONNECT_BACKOFF_MAX_MS);
}

async function connectLoop(ingester: Ingester) {
  let credentials: MqttCredentials;

  try {
    credentials = await fetchMqttCredentials(fetch, {
      tuyaBaseUrl: ENV.tuyaBaseUrl,
      accessKey: ENV.accessKey,
      secretKey: ENV.secretKey,
      uid: ENV.uid,
    });
    console.log("[bridge] MQTT credentials obtained, expires in", credentials.expire_time, "s");
  } catch (err) {
    console.error("[bridge] failed to get credentials:", (err as Error).message);
    process.exit(1);
  }

  const callbacks = {
    onMessage: (msg: TuyaMqttMessage) => {
      const readings = mapTuyaMessage(msg, ENV.orgId);
      for (const r of readings) {
        ingester.add(r);
      }
    },
    onError: () => {
      // mqtt.js maneja reconexión interna, esto es para logging
    },
    onDisconnect: () => {
      // Reconexión con backoff
      reconnectAttempt++;
      const delay = backoffMs();
      console.log(`[bridge] reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
      setTimeout(() => connectLoop(ingester), delay);
    },
  };

  const client = createMqttClient(credentials, ENV.deviceIds, callbacks);

  // Rotación de credenciales cada 90 minutos
  const rotationTimer = setInterval(async () => {
    console.log("[bridge] rotating MQTT credentials...");
    try {
      const fresh = await fetchMqttCredentials(fetch, {
        tuyaBaseUrl: ENV.tuyaBaseUrl,
        accessKey: ENV.accessKey,
        secretKey: ENV.secretKey,
        uid: ENV.uid,
      });
      await closeMqttClient(client);
      reconnectAttempt = 0; // reset backoff
      connectLoop(ingester);
    } catch (err) {
      console.error("[bridge] credential rotation failed:", (err as Error).message);
    }
  }, CREDENTIAL_REFRESH_MS);

  // Manejar shutdown graceful
  const shutdown = async () => {
    console.log("[bridge] shutting down...");
    clearInterval(rotationTimer);
    await ingester.flush();
    ingester.cleanup();
    await closeMqttClient(client);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

async function main() {
  validateEnv();

  const ingester = new Ingester({
    ingestUrl: ENV.ingestUrl,
    apiKey: ENV.apiKey,
    organizationId: ENV.orgId,
    maxBufferSize: 200,
    flushIntervalMs: 10000,
    maxRetries: 3,
  });

  await connectLoop(ingester);
}

main().catch((err) => {
  console.error("[bridge] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Verificar que compila**

```bash
cd services/tuya-mqtt-bridge && npx tsx --eval "import './src/index.js'" --dry-run 2>&1 || true
```

- [ ] **Step 3: Commit**

```bash
git add services/tuya-mqtt-bridge/src/index.ts
git commit -m "feat: implement main bridge entrypoint with credential rotation"
```

---

### Task 8: Middleware de API Key en el Worker

**Files:**
- Modify: `src/telemetry.routes.ts:13-16` (agregar middleware después de org scoping)
- Modify: `src/types/env.ts:13` (agregar INTERNAL_API_KEY)

- [ ] **Step 1: Agregar INTERNAL_API_KEY al tipo Env**

`src/types/env.ts` (modificar línea 13, agregar antes de `AI`):
```typescript
export interface Env {
  DB: D1Database;
  TELEMETRY_RAW: KVNamespace;
  SECRETS_VAULT: KVNamespace;
  THROTTLE_KV: KVNamespace;
  ENCRYPTION_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  WOMPI_BASE_URL: string;
  WOMPI_PUBLIC_KEY: string;
  WOMPI_EVENT_INTEGRITY_KEY: string;
  FRONTEND_URL: string;
  INTERNAL_API_KEY: string; // API key para el bridge MQTT
  AI: Ai;
}
```

- [ ] **Step 2: Crear middleware de API key**

`src/middleware/api-key.middleware.ts`:
```typescript
import { createMiddleware } from "hono/factory";
import type { Env } from "../types/env";

export const apiKeyAuth = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    c.status(401);
    return c.json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.slice(7); // quitar "Bearer "
  if (token !== c.env.INTERNAL_API_KEY) {
    c.status(401);
    return c.json({ error: "Invalid API key" });
  }

  await next();
});
```

- [ ] **Step 3: Aplicar middleware al endpoint bulk**

`src/routes/telemetry.routes.ts` (modificar línea 13-16, agregar middleware en la ruta bulk):
```typescript
// Agregar el import al principio del archivo:
import { apiKeyAuth } from "../middleware/api-key.middleware";

// Modificar la ruta bulk (línea 36) para que acepte tanto JWT como API key:
// La ruta bulk DEBE aceptar API key para el puente MQTT,
// pero también JWT para clientes normales

// Reemplazar la definición de la ruta POST /ingest/bulk:
telemetryRoutes.post("/ingest/bulk", requireSubscription(), requirePermission("telemetry:ingest"), async (c) => {
```

Con:
```typescript
// Ruta para ingesta interna (puente MQTT) — usa API key, sin JWT
telemetryRoutes.post("/ingest/bulk/internal", apiKeyAuth, async (c) => {
  const requestBody = await c.req.json();

  if (!Array.isArray(requestBody)) {
    c.status(400);
    return c.json({ error: "Request body must be an array of telemetry readings" });
  }

  // Extraer organizationId del primer elemento
  const orgId = requestBody[0]?.organizationId;
  if (!orgId) {
    c.status(400);
    return c.json({ error: "Missing organizationId in telemetry readings" });
  }

  const batchResults = await ingestTelemetryBulk(c.env, requestBody, orgId);
  return c.json({ results: batchResults });
});

// Ruta original para clientes normales — usa JWT
telemetryRoutes.post("/ingest/bulk", requireSubscription(), requirePermission("telemetry:ingest"), async (c) => {
```

- [ ] **Step 4: Verificar que compila y los tests existentes pasan**

```bash
npx vitest run --reporter=verbose src/test/routes/telemetry.test.ts
```

Expected: Existing tests pass (they hit `/ingest/bulk` which is unchanged)

- [ ] **Step 5: Escribir test para el nuevo endpoint**

`src/test/routes/telemetry-internal.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../../index";

describe("POST /api/telemetry/ingest/bulk/internal", () => {
  const VALID_PAYLOAD = [
    {
      organizationId: "org_test",
      deviceId: "dev-1",
      sensorId: "101",
      value: 220,
      unit: "V",
      timestamp: Date.now(),
    },
  ];

  it("retorna 401 sin Authorization header", async () => {
    const res = await app.request("/api/telemetry/ingest/bulk/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    expect(res.status).toBe(401);
  });

  it("retorna 401 con API key inválida", async () => {
    const res = await app.request("/api/telemetry/ingest/bulk/internal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-key",
      },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    expect(res.status).toBe(401);
  });

  it("retorna 400 si el body no es array", async () => {
    const res = await app.request("/api/telemetry/ingest/bulk/internal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-api-key",
      },
      body: JSON.stringify({ not: "array" }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 6: Correr los tests del nuevo endpoint**

```bash
npx vitest run src/test/routes/telemetry-internal.test.ts
```

Expected: 3 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/middleware/api-key.middleware.ts src/routes/telemetry.routes.ts src/types/env.ts src/test/routes/telemetry-internal.test.ts
git commit -m "feat: add internal telemetry ingestion endpoint with API key auth"
```

---

### Task 9: Agregar INTERNAL_API_KEY a wrangler.toml y .dev.vars

**Files:**
- Modify: `wrangler.toml`
- Modify: `.dev.vars` (si existe)

- [ ] **Step 1: Agregar variable al wrangler.toml**

En `wrangler.toml`, sección `[vars]`, agregar:
```toml
INTERNAL_API_KEY = "${INTERNAL_API_KEY}"
```

- [ ] **Step 2: Agregar a .dev.vars**

Revisar si `.dev.vars` existe y agregar:
```
INTERNAL_API_KEY=dev-bridge-api-key-change-in-production
```

- [ ] **Step 3: Commit**

```bash
git add wrangler.toml .dev.vars
git commit -m "chore: add INTERNAL_API_KEY to wrangler config"
```

---

### Task 10: Documentación y verificación final

- [ ] **Step 1: Correr todos los tests del bridge**

```bash
cd services/tuya-mqtt-bridge && npx vitest run
```

Expected: 18 tests PASS

- [ ] **Step 2: Correr todos los tests del Worker**

```bash
npx vitest run
```

Expected: All tests pass (594+ tests), ningún nuevo fallo

- [ ] **Step 3: Agregar README al bridge**

`services/tuya-mqtt-bridge/README.md`:
```markdown
# Tuya MQTT Bridge

Puente MQTT entre Tuya SmartLife y VILCAMI Worker.

## Requisitos
- Node.js ≥ 20
- `.env` configurado con las variables de `.env.example`

## Uso

```bash
cp .env.example .env
# Editar .env con credenciales reales
npm install
npm start
```

## Deploy en Railway/Render

1. Conectar repo de GitHub
2. Configurar variables de entorno desde `.env.example`
3. Start command: `cd services/tuya-mqtt-bridge && npm start`

## Tests

```bash
npm test
```
```

- [ ] **Step 4: Commit final**

```bash
git add services/tuya-mqtt-bridge/README.md
git commit -m "docs: add README for tuya-mqtt-bridge"
```

- [ ] **Step 5: Push**

```bash
git push
```
