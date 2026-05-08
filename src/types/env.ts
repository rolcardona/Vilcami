export interface Env {
  DB: D1Database;
  TELEMETRY_RAW: KVNamespace;
  SECRETS_VAULT: KVNamespace;
  ENCRYPTION_KEY: string;
}