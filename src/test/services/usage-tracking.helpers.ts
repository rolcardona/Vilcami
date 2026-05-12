/**
 * Shared test utilities for usage-tracking service tests.
 * Mocks KVNamespace and Drizzle DB for isolated unit testing.
 */

// ---------------------------------------------------------------------------
// Mock KV type — KVNamespace with an accessible store for test assertions
// ---------------------------------------------------------------------------
export interface MockKV extends KVNamespace {
  store: Map<string, { value: string; expirationTtl?: number }>;
}

// ---------------------------------------------------------------------------
// Mock KV — simulates Cloudflare KVNamespace for throttle operations
// ---------------------------------------------------------------------------
export function createMockKV(): MockKV {
  const store = new Map<string, { value: string; expirationTtl?: number }>();
  return {
    store,
    async get(key: string) {
      const entry = store.get(key);
      return entry?.value ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      store.set(key, { value, expirationTtl: options?.expirationTtl });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const prefix = options?.prefix ?? "";
      const limit = options?.limit ?? 1000;
      const matchingKeys = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .slice(0, limit);
      return {
        keys: matchingKeys.map((name) => ({ name })),
        list_complete: true as const,
      };
    },
    async getWithMetadata(key: string) {
      const entry = store.get(key);
      return { value: entry?.value ?? null, metadata: null };
    },
  } as unknown as MockKV;
}

// ---------------------------------------------------------------------------
// Mock DB — captures Drizzle inserts for billing events
// ---------------------------------------------------------------------------
export function createMockDb() {
  const insertedRows: Array<Record<string, unknown>> = [];
  return {
    insertedRows,
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        run: async () => {
          insertedRows.push(row);
        },
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Hour bucket helper — mirrors the service's internal getHourBucket
// ---------------------------------------------------------------------------
export function makeHourBucket(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:00`;
}

export const ORG_ID = "org-test-001";
export const DEVICE_ID = "device-sensor-042";