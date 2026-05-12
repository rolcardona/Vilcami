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
  AI: Ai; // Workers AI binding (Phase 4)
}