import { TuyaContext } from "@tuya/tuya-connector-nodejs";

const PROJECT_CODE = "p1777384854684fqemu8";

async function tryDatacenter(name, baseUrl) {
  console.log(`\n=== Probando ${name}: ${baseUrl} ===`);
  try {
    const tuya = new TuyaContext({
      baseUrl,
      accessKey: "gd9jsn3yhkqj7wfvmenq",
      secretKey: "13c42349612844b996abbc108477f5e8",
    });

    // Use raw request to query devices with project_code
    const res = await tuya.request({
      path: `/v1.0/iot-03/devices`,
      method: "GET",
      query: { project_code: PROJECT_CODE, page_no: 1, page_size: 50 },
    });

    if (res.data?.success) {
      const list = res.data.result?.list ?? [];
      console.log(`  ${list.length} dispositivos encontrados`);
      return { name, list, tuya };
    } else {
      console.log(`  Error: ${res.data?.code} - ${res.data?.msg}`);
      return null;
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
    return null;
  }
}

// Try multiple datacenters
const datacenters = [
  ["US West", "https://openapi.tuyaus.com"],
  ["US East", "https://openapi-ueaz.tuyaus.com"],
  ["China", "https://openapi.tuyacn.com"],
  ["Europe", "https://openapi.tuyaeu.com"],
  ["India", "https://openapi.tuyain.com"],
];

let result = null;
for (const [name, url] of datacenters) {
  result = await tryDatacenter(name, url);
  if (result && result.list.length > 0) break;
}

if (!result || result.list.length === 0) {
  console.log("\n0 dispositivos en todos los datacenters.");
  console.log("Posible: el proyecto IoT no tiene dispositivos vinculados todavia.");
  console.log("Desde la consola Tuya IoT: Devices -> Link App Account -> verificar que SmartLife aparezca como vinculado.");
  process.exit(0);
}

// Show devices with status
console.log("\n═══════════════════════════════════════════");
console.log(`  DATACENTER: ${result.name}`);
console.log("═══════════════════════════════════════════\n");

for (const d of result.list) {
  console.log("────────────────────────────────────────");
  console.log(`  Nombre:      ${d.name}`);
  console.log(`  ID:          ${d.id}`);
  console.log(`  Categoria:   ${d.category_name ?? d.category ?? "N/A"}`);
  console.log(`  Online:      ${d.online ? "SI" : "NO"}`);
  console.log(`  Modelo:      ${d.product_name ?? d.product_name ?? "N/A"}`);
  console.log(`  UUID:        ${d.uuid ?? "N/A"}`);

  // Real-time status
  try {
    const statusRes = await result.tuya.request({
      path: `/v1.0/iot-03/devices/${d.id}/status`,
      method: "GET",
    });
    if (statusRes.data?.success && statusRes.data?.result) {
      console.log("  Datos en tiempo real:");
      const statusData = statusRes.data.result;
      // result can be array of {code, value} or an object
      const items = Array.isArray(statusData) ? statusData : [statusData];
      for (const s of items) {
        console.log(`    ${s.code}: ${JSON.stringify(s.value)}`);
      }
    } else {
      console.log("  Status: (sin datos)");
    }
  } catch (e) {
    console.log(`  Status: (error: ${e.message})`);
  }
  console.log("");
}

console.log("LISTO — Solo lectura, nada modificado.");
