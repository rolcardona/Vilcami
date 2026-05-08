import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const weatherCache = sqliteTable("weather_cache", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  temperatureCelsius: real("temperature_celsius"),
  humidityPercent: real("humidity_percent"),
  windSpeedKmh: real("wind_speed_kmh"),
  weatherCode: integer("weather_code"),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});