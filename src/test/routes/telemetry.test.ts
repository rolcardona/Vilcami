import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";

async function generateTestKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
}

async function createSignedJwt(
	payload: Record<string, unknown>,
	privateKey: CryptoKey,
	kid: string = "test-key-id",
): Promise<string> {
	const header = { alg: "RS256", typ: "JWT", kid };
	const headerB64 = btoa(JSON.stringify(header)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	const payloadB64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	const signInput = `${headerB64}.${payloadB64}`;
	const signData = new TextEncoder().encode(signInput);
	const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, signData);
	const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return `${headerB64}.${payloadB64}.${sigB64}`;
}

let testPrivateKey: CryptoKey;
let testPublicKeyJwk: JsonWebKey;
let originalFetch: typeof globalThis.fetch;

const { mockIngest, mockBulk } = vi.hoisted(() => ({ mockIngest: vi.fn(), mockBulk: vi.fn() }));

vi.mock("../../services/telemetry-ingestion.service", () => ({
	ingestTelemetry: mockIngest,
	ingestTelemetryBulk: mockBulk,
}));

interface KvOptions {
	keys?: Array<{ name: string }>;
	data?: Record<string, string>;
}

function mockEnv(options?: KvOptions): Env {
	const listFn = vi.fn().mockResolvedValue({ keys: options?.keys ?? [] });
	const getFn = vi.fn().mockImplementation((k: string) =>
		Promise.resolve(options?.data?.[k] ?? null),
	);
	return {
		DB: {} as D1Database,
		TELEMETRY_RAW: { put: vi.fn(), list: listFn, get: getFn } as unknown as KVNamespace,
		SECRETS_VAULT: {
			get: vi.fn().mockResolvedValue(
				JSON.stringify({ keys: [testPublicKeyJwk], cachedAt: Date.now() }),
			),
			put: vi.fn().mockResolvedValue(undefined),
		} as unknown as KVNamespace,
		ENCRYPTION_KEY: "test-key",
		SUPABASE_URL: "https://test-project.supabase.co",
		SUPABASE_ANON_KEY: "test-anon-key",
		AI: { run: vi.fn() } as unknown as Ai,
	};
}

async function createAuthHeaders(overrides: Partial<{ sub: string; org_id: string | null; role: string; mfa_verified: boolean }> = {}): Promise<Record<string, string>> {
	const mfa = overrides.mfa_verified ?? false;
	const claims: Record<string, unknown> = {
		sub: overrides.sub ?? "user-001",
		org_id: overrides.org_id ?? "org-001",
		role: overrides.role ?? "user",
		aal: mfa ? "aal2" : "aal1",
		iss: "https://test-project.supabase.co",
		exp: Math.floor(Date.now() / 1000) + 3600,
		iat: Math.floor(Date.now() / 1000),
	};
	const token = await createSignedJwt(claims, testPrivateKey);
	return { Authorization: `Bearer ${token}` };
}

const validReading = {
	organizationId: "org-001", deviceId: "dev-001", sensorId: "sensor-temp",
	value: 42.5, unit: "Celsius", timestamp: 1700000000000,
};

describe("Telemetry Routes", () => {
	beforeAll(async () => {
		const keyPair = await generateTestKeyPair();
		testPrivateKey = keyPair.privateKey;
		const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
		testPublicKeyJwk = { ...exported, kid: "test-key-id", alg: "RS256" } as unknown as JsonWebKey;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ keys: [testPublicKeyJwk] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	async function setupApp(): Promise<{ app: Hono<{ Bindings: Env }>; env: Env }> {
		const { telemetryRoutes } = await import("../../routes/telemetry.routes");
		const app = new Hono<{ Bindings: Env }>();
		app.route("/api/telemetry", telemetryRoutes);
		return { app, env: mockEnv() };
	}

	// Auth gating
	it("POST /ingest without auth => 401", async () => {
		const { app, env } = await setupApp();
		const res = await app.request("/api/telemetry/ingest",
			{ method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }, env);
		expect(res.status).toBe(401);
	});

	it("POST /ingest/bulk without auth => 401", async () => {
		const { app, env } = await setupApp();
		const res = await app.request("/api/telemetry/ingest/bulk",
			{ method: "POST", body: "[]", headers: { "Content-Type": "application/json" } }, env);
		expect(res.status).toBe(401);
	});

	it("GET /:deviceId without auth => 401", async () => {
		const { app, env } = await setupApp();
		const res = await app.request("/api/telemetry/device-001", { method: "GET" }, env);
		expect(res.status).toBe(401);
	});

	// Single ingest
	it("POST /ingest valid payload => 200 with telemetryId", async () => {
		const fakeId = "550e8400-e29b-41d4-a716-446655440000";
		mockIngest.mockResolvedValue({ success: true, telemetryId: fakeId });
		const { app, env } = await setupApp();
		const headers = await createAuthHeaders({ org_id: "org-001" });

		const res = await app.request("/api/telemetry/ingest", {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(validReading),
		}, env);

		expect(res.status).toBe(200);
		const body = await res.json() as { telemetryId: string; success: boolean };
		expect(body.telemetryId).toBe(fakeId);
		expect(body.success).toBe(true);
		expect(mockIngest).toHaveBeenCalledWith(env, validReading, "org-001");
	});

	it("POST /ingest invalid payload => 400 with error", async () => {
		mockIngest.mockResolvedValue({ success: false, error: "Validation failed" });
		const { app, env } = await setupApp();
		const headers = await createAuthHeaders();

		const res = await app.request("/api/telemetry/ingest", {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ deviceId: "dev-001" }),
		}, env);

		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe("Validation failed");
	});

	// Bulk ingest
	it("POST /ingest/bulk valid => 200 with results array", async () => {
		const results = [
			{ success: true, telemetryId: "id-1", index: 0 },
			{ success: false, error: "Bad", index: 1 },
		];
		mockBulk.mockResolvedValue(results);
		const { app, env } = await setupApp();
		const headers = await createAuthHeaders({ org_id: "org-001" });

		const res = await app.request("/api/telemetry/ingest/bulk", {
			method: "POST",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify([validReading, validReading]),
		}, env);

		expect(res.status).toBe(200);
		const body = await res.json() as { results: typeof results };
		expect(body.results).toHaveLength(2);
		expect(body.results[0].success).toBe(true);
		expect(body.results[1].success).toBe(false);
		expect(mockBulk).toHaveBeenCalledWith(env, [validReading, validReading], "org-001");
	});

	// GET telemetry
	it("GET /:deviceId with data => 200, sorted by most recent first", async () => {
		const entryA = { ...validReading, timestamp: 1700000002000, sensorId: "s-a", value: 23.5 };
		const entryB = { ...validReading, timestamp: 1700000001000, sensorId: "s-b", value: 60.0 };
		const keyA = `telemetry:org-001:dev-001:${entryA.timestamp}:s-a`;
		const keyB = `telemetry:org-001:dev-001:${entryB.timestamp}:s-b`;

		const { app } = await setupApp();
		const customEnv = mockEnv({ keys: [{ name: keyA }, { name: keyB }],
			data: { [keyA]: JSON.stringify(entryA), [keyB]: JSON.stringify(entryB) } });
		const headers = await createAuthHeaders({ org_id: "org-001" });

		const res = await app.request("/api/telemetry/dev-001",
			{ method: "GET", headers }, customEnv);

		expect(res.status).toBe(200);
		const body = await res.json() as { deviceId: string; entries: Array<{ timestamp: number }>; total: number };
		expect(body.deviceId).toBe("dev-001");
		expect(body.entries).toHaveLength(2);
		expect(body.total).toBe(2);
		expect(body.entries[0].timestamp).toBeGreaterThan(body.entries[1].timestamp);
	});

	it("GET /:deviceId with no data => 200, empty array", async () => {
		const { app } = await setupApp();
		const env = mockEnv({ keys: [] });
		const headers = await createAuthHeaders({ org_id: "org-001" });

		const res = await app.request("/api/telemetry/device-empty",
			{ method: "GET", headers }, env);

		expect(res.status).toBe(200);
		const body = await res.json() as { deviceId: string; entries: unknown[]; total: number };
		expect(body.deviceId).toBe("device-empty");
		expect(body.entries).toEqual([]);
		expect(body.total).toBe(0);
	});
});