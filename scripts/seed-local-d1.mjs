import { DatabaseSync } from "node:sqlite";

const DB =
  ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/09d607b7e2fb5a679d6e994b516b578e682e1b3f534b9a333faed9ec4f582e41.sqlite";
const db = new DatabaseSync(DB);
const nowIso = new Date().toISOString();
const nowMs = Date.now();
const nowUnix = Math.floor(nowMs / 1000);

// ---- Wipe in FK-safe order ----
db.exec("DELETE FROM billing_events");
db.exec("DELETE FROM payments");
db.exec("DELETE FROM wompi_events");
db.exec("DELETE FROM alert_audit_log");
db.exec("DELETE FROM alert_escalations");
db.exec("DELETE FROM alert_lifecycle");
db.exec("DELETE FROM alerts");
db.exec("DELETE FROM alert_rules");
db.exec("DELETE FROM weather_cache");
db.exec("DELETE FROM compliance_reports");
db.exec("DELETE FROM compliance_templates");
db.exec("DELETE FROM daily_summaries");
db.exec("DELETE FROM hourly_averages");
db.exec("DELETE FROM device_sensors");
db.exec("DELETE FROM device_subscriptions");
db.exec("DELETE FROM devices");
db.exec("DELETE FROM push_subscriptions");
db.exec("DELETE FROM member_profiles");
db.exec("DELETE FROM subscription_plans");
console.log("Cleaned all tables");

// ---- 1. Subscription plans ----
db.exec(`
  INSERT INTO subscription_plans (id, name, currency_code, price_per_device_cents, events_included, overage_price_per_hundred_cents, features, trial_days, max_trial_devices, is_trial_plan) VALUES
    ('plan-trial',  'trial',        'COP', 0,     10000,  100, '[]', 30, 3,          1),
    ('plan-starter','starter',      'COP', 4900,   50000,   80, '[]',  0, 10,         0),
    ('plan-prof',   'professional', 'COP', 11900, 200000,   50, '[]',  0, 50,         0),
    ('plan-ent',    'enterprise',   'COP', 19900, 1000000,  30, '[]',  0, 2147483647, 0)
`);
console.log("Plans");

// ---- 2. Devices ----
for (const [id, name, extId, proto, loc, lat, lon] of [
  ["dev-001", "Camara Fria Principal", "ext-cf-001", "MODBUS", "Zona Norte, Bodega A", 4.6097, -74.0817],
  ["dev-002", "Congelador Carnes", "ext-cf-002", "MODBUS", "Zona Norte, Bodega A", 4.6098, -74.0818],
  ["dev-003", "Cuarto Refrigeracion", "ext-cr-001", "RS485", "Zona Sur, Laboratorio", 4.6100, -74.0820],
]) {
  db.prepare(
    `INSERT INTO devices (id, organization_id, name, device_external_id, protocol_type, location, latitude, longitude, status, last_seen_at, created_at)
     VALUES (?, 'org-001', ?, ?, ?, ?, ?, ?, 'online', ?, ?)`,
  ).run(id, name, extId, proto, loc, lat, lon, nowIso, nowIso);
}
console.log("Devices");

// ---- 3. Device subscriptions ----
for (const devId of ["dev-001", "dev-002", "dev-003"]) {
  db.prepare(
    `INSERT INTO device_subscriptions (id, organization_id, device_id, plan_id, status, current_period_start, current_period_end, created_at)
     VALUES (?, 'org-001', ?, 'plan-prof', 'active', ?, ?, ?)`,
  ).run(`sub-${devId}`, devId, nowUnix, nowUnix + 2592000, nowUnix);
}
console.log("Subscriptions");

// ---- 4. Sensors ----
for (const [id, devId, type, unit, min, max] of [
  ["sen-001", "dev-001", "temperature", "celsius", -30, 10],
  ["sen-002", "dev-001", "humidity", "percent", 20, 90],
  ["sen-003", "dev-002", "temperature", "celsius", -40, -10],
  ["sen-004", "dev-002", "humidity", "percent", 15, 85],
  ["sen-005", "dev-003", "temperature", "celsius", 0, 8],
]) {
  db.prepare(
    `INSERT INTO device_sensors (id, device_id, sensor_type, unit, min_threshold, max_threshold, is_alertable)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  ).run(id, devId, type, unit, min, max);
}
console.log("Sensors");

// ---- 5. Hourly averages (24h) ----
for (let h = 0; h < 24; h++) {
  const d = new Date(nowMs - h * 3_600_000);
  const bucket = d.toISOString().replace("T", " ").substring(0, 13) + ":00:00";
  for (const [senId, devId] of [
    ["sen-001", "dev-001"],
    ["sen-002", "dev-001"],
    ["sen-003", "dev-002"],
    ["sen-005", "dev-003"],
  ]) {
    const base =
      senId === "sen-001" ? 2 : senId === "sen-003" ? -25 : senId === "sen-005" ? 4 : 65;
    const noise = Math.sin(h / 4) * 3 + (Math.random() - 0.5) * 2;
    const avg = Math.round((base + noise) * 100) / 100;
    db.prepare(
      `INSERT INTO hourly_averages (id, organization_id, device_id, sensor_id, hour_bucket, avg_value, min_value, max_value, sample_count, created_at)
       VALUES (?, 'org-001', ?, ?, ?, ?, ?, ?, 60, ?)`,
    ).run(`ha-${devId}-h${h}-${senId}`, devId, senId, bucket, avg, avg - 1, avg + 1, nowIso);
  }
}
console.log("Hourly (24h)");

// ---- 6. Daily summaries (7d) ----
for (let d = 0; d < 7; d++) {
  const day = new Date(nowMs - d * 86_400_000).toISOString().substring(0, 10);
  for (const [senId, devId] of [
    ["sen-001", "dev-001"],
    ["sen-003", "dev-002"],
    ["sen-005", "dev-003"],
  ]) {
    const base = senId === "sen-001" ? 2 : senId === "sen-003" ? -25 : 4;
    const avg = Math.round((base + (Math.random() - 0.5) * 2) * 100) / 100;
    db.prepare(
      `INSERT INTO daily_summaries (id, organization_id, device_id, sensor_id, date_bucket, avg_value, min_value, max_value, std_dev, sample_count, alert_count, created_at)
       VALUES (?, 'org-001', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `ds-${devId}-d${d}-${senId}`,
      devId,
      senId,
      day,
      avg,
      Math.round((avg - 2) * 100) / 100,
      Math.round((avg + 2) * 100) / 100,
      Math.round(Math.random() * 200) / 100,
      1440,
      Math.floor(Math.random() * 3),
      nowIso,
    );
  }
}
console.log("Daily (7d)");

// ---- 7. Alert rules ----
db.prepare(
  `INSERT INTO alert_rules (id, organization_id, device_id, sensor_id, rule_name, severity, condition_operator, threshold_value, deadband_value, time_delay_seconds, channels, enabled)
   VALUES ('rule-001', 'org-001', 'dev-001', 'sen-001', 'Temp alta camara fria', 'medium', 'gt', 8.0, 0.5, 300, '["email"]', 1)`,
).run();
db.prepare(
  `INSERT INTO alert_rules (id, organization_id, device_id, sensor_id, rule_name, severity, condition_operator, threshold_value, deadband_value, time_delay_seconds, channels, enabled)
   VALUES ('rule-003', 'org-001', 'dev-002', 'sen-003', 'Temp alta congelador', 'high', 'gt', -10.0, 0.3, 180, '["email","push"]', 1)`,
).run();
db.prepare(
  `INSERT INTO alert_rules (id, organization_id, device_id, sensor_id, rule_name, severity, condition_operator, threshold_value, deadband_value, time_delay_seconds, channels, enabled)
   VALUES ('rule-005', 'org-001', 'dev-003', 'sen-005', 'Temp refrigeracion', 'low', 'gt', 6.0, 0.4, 600, '["email"]', 1)`,
).run();
console.log("Alert rules");

// ---- 8. Alerts ----
db.prepare(
  `INSERT INTO alerts (id, organization_id, device_id, sensor_id, severity, rule_type, alert_rule_id, current_value, threshold_value, message, ai_context, channels, acknowledged_at, resolved_at, created_at)
   VALUES ('alert-001', 'org-001', 'dev-002', 'sen-003', 'high', 'threshold', 'rule-003', -8.5, -10.0, 'Temperatura congelador subiendo peligrosamente', 'Compresor muestra patron de ciclos cortos. Posible fuga de refrigerante.', '["email","push"]', NULL, NULL, ?)`,
).run(nowIso);
db.prepare(
  `INSERT INTO alerts (id, organization_id, device_id, sensor_id, severity, rule_type, alert_rule_id, current_value, threshold_value, message, ai_context, channels, acknowledged_at, resolved_at, created_at)
   VALUES ('alert-002', 'org-001', 'dev-001', 'sen-001', 'medium', 'threshold', 'rule-001', 7.3, 8.0, 'Camara fria acercandose a limite superior', NULL, '["email"]', ?, NULL, ?)`,
).run(nowIso, nowIso);
db.prepare(
  `INSERT INTO alerts (id, organization_id, device_id, sensor_id, severity, rule_type, alert_rule_id, current_value, threshold_value, message, ai_context, channels, acknowledged_at, resolved_at, created_at)
   VALUES ('alert-003', 'org-001', 'dev-003', 'sen-005', 'low', 'threshold', 'rule-005', 4.1, 6.0, 'Temperatura refrigeracion dentro de rango optimo', NULL, '["email"]', NULL, ?, ?)`,
).run(nowIso, nowIso);
console.log("Alerts");

console.log("DONE — database seeded");
db.close();
