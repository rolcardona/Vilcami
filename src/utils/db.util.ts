import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../types/env";
import type { DrizzleD1Database } from "drizzle-orm/d1";

let cachedDrizzleInstance: DrizzleD1Database | null = null;

export function getDrizzleDb(env: Env): DrizzleD1Database {
  if (!cachedDrizzleInstance) {
    cachedDrizzleInstance = drizzle(env.DB);
  }
  return cachedDrizzleInstance;
}
