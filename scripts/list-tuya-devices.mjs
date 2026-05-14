import { TuyaContext } from "@tuya/tuya-connector-nodejs";

const BASE_URL = "https://openapi.tuyaus.com";
const ACCESS_KEY = "gd9jsn3yhkqj7wfvmenq";
const SECRET_KEY = "13c42349612844b996abbc108477f5e8";

const tuya = new TuyaContext({
  baseUrl: BASE_URL,
  accessKey: ACCESS_KEY,
  secretKey: SECRET_KEY,
});

console.log("=== VILCAMI — Listado de dispositivos SmartLife (SOLO LECTURA) ===\n");

// Step 1 — List devices linked via SmartLife
const res = await tuya.request({
  path: "/v1.0/iot-01/associated-users/devices",
  method: "GET",
});

if (!res.success) {
  console.log(`Error: ${res.code} - ${res.msg}`);
  process.exit(1);
}

const devices = res.result?.devices ?? [];
console.log(`${devices.length} dispositivos encontrados en US West (openapi.tuyaus.com)\n`);

if (devices.length === 0) {
  console.log("Posible: la cuenta SmartLife no esta vinculada al proyecto Tuya.");
  console.log("Desde la consola Tuya IoT: Devices -> Link App Account -> vincular SmartLife.");
  process.exit(0);
}

// Step 2 — Get real-time status for each device
for (const d of devices) {
  console.log("────────────────────────────────────────");
  console.log(`  Nombre:      ${d.name}`);
  console.log(`  ID:          ${d.id}`);
  console.log(`  Modelo:      ${d.product_name ?? "N/A"}`);
  console.log(`  Categoria:   ${d.category ?? "N/A"}`);
  console.log(`  Online:      ${d.online ? "SI" : "NO"}`);
  console.log(`  UUID:        ${d.uuid ?? "N/A"}`);
  console.log(`  IP:          ${d.ip ?? "N/A"}`);
  console.log(`  Ubicacion:   ${d.lat}, ${d.lon}`);

  // Real-time status via IoT Core
  try {
    const statusRes = await tuya.request({
      path: `/v1.0/iot-03/devices/${d.id}/status`,
      method: "GET",
    });
    if (statusRes.success && statusRes.result) {
      console.log("  Datos en tiempo real:");
      const statusData = statusRes.result;
      const items = Array.isArray(statusData) ? statusData : [statusData];
      for (const s of items) {
        console.log(`    ${s.code}: ${JSON.stringify(s.value)}`);
      }
    } else {
      console.log(`  Status: (sin datos — ${statusRes.code ?? "N/A"}: ${statusRes.msg ?? "N/A"})`);
    }
  } catch (e) {
    console.log(`  Status: (error: ${e.message})`);
  }
  console.log("");
}

console.log("LISTO — Solo lectura, nada modificado.");
