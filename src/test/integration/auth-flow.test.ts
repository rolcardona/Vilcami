import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../types/env";
import { authMiddleware, orgScopingMiddleware } from "../../middleware/auth.middleware";

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
	const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(signInput));
	const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return `${headerB64}.${payloadB64}.${sigB64}`;
}

describe("Full auth flow integration", () => {
	let testPrivateKey: CryptoKey;
	let testPublicKeyJwk: JsonWebKey;
	let originalFetch: typeof globalThis.fetch;

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

	function createTestEnv(): Env {
		return {
			DB: {} as D1Database,
			TELEMETRY_RAW: {} as KVNamespace,
			SECRETS_VAULT: {
				get: vi.fn().mockResolvedValue(
					JSON.stringify({ keys: [testPublicKeyJwk], cachedAt: Date.now() }),
				),
				put: vi.fn().mockResolvedValue(undefined),
			} as unknown as KVNamespace,
			ENCRYPTION_KEY: "test-key",
			SUPABASE_URL: "https://test-project.supabase.co",
			SUPABASE_ANON_KEY: "test-anon-key",
			THROTTLE_KV: {} as KVNamespace,
			WOMPI_BASE_URL: "https://sandbox.wompi.co/v1",
			WOMPI_PUBLIC_KEY: "test-pub-key",
			WOMPI_EVENT_INTEGRITY_KEY: "test-integrity-key",
			AI: { run: vi.fn() } as unknown as Ai,
		};
	}

	it("should chain authMiddleware → orgScopingMiddleware end-to-end for admin_vilcami", async () => {
		const app = new Hono<{ Bindings: Env }>();
		app.use("*", authMiddleware);
		app.use("*", orgScopingMiddleware);
		app.get("/scoped", (c) => c.json({
			role: c.get("jwtPayload").role,
			filter: c.get("organizationFilter"),
		}));

		const token = await createSignedJwt({
			sub: "super-001", org_id: "vilcami", role: "admin_vilcami", aal: "aal1",
			iss: "https://test-project.supabase.co",
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
		}, testPrivateKey);

		const res = await app.request("/scoped", {
			headers: { Authorization: `Bearer ${token}` },
		}, createTestEnv());
		expect(res.status).toBe(200);
		const body = await res.json() as { role: string; filter: string | null };
		expect(body.role).toBe("admin_vilcami");
		expect(body.filter).toBeNull();
	});

	it("should chain authMiddleware → orgScopingMiddleware end-to-end for admin with MFA", async () => {
		const app = new Hono<{ Bindings: Env }>();
		app.use("*", authMiddleware);
		app.use("*", orgScopingMiddleware);
		app.get("/scoped", (c) => c.json({
			role: c.get("jwtPayload").role,
			filter: c.get("organizationFilter"),
		}));

		const token = await createSignedJwt({
			sub: "admin-001", org_id: "org-001", role: "admin", aal: "aal2",
			iss: "https://test-project.supabase.co",
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
		}, testPrivateKey);

		const res = await app.request("/scoped", {
			headers: { Authorization: `Bearer ${token}` },
		}, createTestEnv());
		expect(res.status).toBe(200);
		const body = await res.json() as { role: string; filter: string | null };
		expect(body.role).toBe("admin");
		expect(body.filter).toBe("org-001");
	});

	it("should reject admin without MFA in full chain", async () => {
		const app = new Hono<{ Bindings: Env }>();
		app.use("*", authMiddleware);
		app.use("*", orgScopingMiddleware);
		app.get("/scoped", (c) => c.json({ ok: true }));

		const token = await createSignedJwt({
			sub: "admin-001", org_id: "org-001", role: "admin", aal: "aal1",
			iss: "https://test-project.supabase.co",
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
		}, testPrivateKey);

		const res = await app.request("/scoped", {
			headers: { Authorization: `Bearer ${token}` },
		}, createTestEnv());
		expect(res.status).toBe(403);
	});

	it("should reject expired token in full chain", async () => {
		const app = new Hono<{ Bindings: Env }>();
		app.use("*", authMiddleware);
		app.use("*", orgScopingMiddleware);
		app.get("/scoped", (c) => c.json({ ok: true }));

		const token = await createSignedJwt({
			sub: "user-001", org_id: "org-001", role: "user", aal: "aal1",
			iss: "https://test-project.supabase.co",
			exp: Math.floor(Date.now() / 1000) - 3600,
			iat: Math.floor(Date.now() / 1000) - 7200,
		}, testPrivateKey);

		const res = await app.request("/scoped", {
			headers: { Authorization: `Bearer ${token}` },
		}, createTestEnv());
		expect(res.status).toBe(401);
	});

	it("should chain authMiddleware → orgScopingMiddleware for regular user with org scope", async () => {
		const app = new Hono<{ Bindings: Env }>();
		app.use("*", authMiddleware);
		app.use("*", orgScopingMiddleware);
		app.get("/scoped", (c) => c.json({
			role: c.get("jwtPayload").role,
			filter: c.get("organizationFilter"),
		}));

		const token = await createSignedJwt({
			sub: "user-001", org_id: "org-001", role: "user", aal: "aal1",
			iss: "https://test-project.supabase.co",
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
		}, testPrivateKey);

		const res = await app.request("/scoped", {
			headers: { Authorization: `Bearer ${token}` },
		}, createTestEnv());
		expect(res.status).toBe(200);
		const body = await res.json() as { role: string; filter: string | null };
		expect(body.role).toBe("user");
		expect(body.filter).toBe("org-001");
	});

	it("should reject forged JWT signed with wrong key in full chain", async () => {
		const app = new Hono<{ Bindings: Env }>();
		app.use("*", authMiddleware);
		app.use("*", orgScopingMiddleware);
		app.get("/scoped", (c) => c.json({ ok: true }));

		// Generate a different key pair — simulates an attacker
		const attackerKeyPair = await generateTestKeyPair();
		const token = await createSignedJwt({
			sub: "attacker-001", org_id: "org-001", role: "admin", aal: "aal2",
			iss: "https://test-project.supabase.co",
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
		}, attackerKeyPair.privateKey);

		const res = await app.request("/scoped", {
			headers: { Authorization: `Bearer ${token}` },
		}, createTestEnv());
		expect(res.status).toBe(401);
	});

	it("should reject JWT with wrong issuer in full chain", async () => {
		const app = new Hono<{ Bindings: Env }>();
		app.use("*", authMiddleware);
		app.use("*", orgScopingMiddleware);
		app.get("/scoped", (c) => c.json({ ok: true }));

		const token = await createSignedJwt({
			sub: "user-001", org_id: "org-001", role: "user", aal: "aal1",
			iss: "https://evil-attacker.com",
			exp: Math.floor(Date.now() / 1000) + 3600,
			iat: Math.floor(Date.now() / 1000),
		}, testPrivateKey);

		const res = await app.request("/scoped", {
			headers: { Authorization: `Bearer ${token}` },
		}, createTestEnv());
		expect(res.status).toBe(401);
	});
});