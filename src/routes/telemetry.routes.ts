import { Hono } from "hono";
import type { Env } from "../types/env";
import type { JwtPayload } from "../auth/jwt-verifier";
import { authMiddleware, orgScopingMiddleware } from "../middleware/auth.middleware";
import {
	ingestTelemetry,
	ingestTelemetryBulk,
} from "../services/telemetry-ingestion.service";

export const telemetryRoutes = new Hono<{ Bindings: Env }>();

// All telemetry routes require authentication and org scoping
telemetryRoutes.use("*", authMiddleware);
telemetryRoutes.use("*", orgScopingMiddleware);

// POST /api/telemetry/ingest — ingest a single telemetry reading
telemetryRoutes.post("/ingest", async (c) => {
	const jwtPayload = c.get("jwtPayload") as JwtPayload;
	if (!jwtPayload.org_id) {
		return c.json({ error: "User must belong to an organization to ingest telemetry" }, 403);
	}
	const requestBody = await c.req.json();
	const ingestResult = await ingestTelemetry(c.env, requestBody, jwtPayload.org_id);

	if (!ingestResult.success) {
		c.status(400);
		return c.json({ error: ingestResult.error });
	}

	return c.json({ telemetryId: ingestResult.telemetryId, success: true });
});

// POST /api/telemetry/ingest/bulk — ingest multiple telemetry readings
telemetryRoutes.post("/ingest/bulk", async (c) => {
	const jwtPayload = c.get("jwtPayload") as JwtPayload;
	if (!jwtPayload.org_id) {
		return c.json({ error: "User must belong to an organization to ingest telemetry" }, 403);
	}
	const requestBody = await c.req.json();

	if (!Array.isArray(requestBody)) {
		c.status(400);
		return c.json({ error: "Request body must be an array of telemetry readings" });
	}

	const batchResults = await ingestTelemetryBulk(c.env, requestBody, jwtPayload.org_id);
	return c.json({ results: batchResults });
});

// GET /api/telemetry/:deviceId — fetch recent telemetry for a device from KV
telemetryRoutes.get("/:deviceId", async (c) => {
	const jwtPayload = c.get("jwtPayload") as JwtPayload;
	const deviceIdentifier = c.req.param("deviceId");
	const maxEntries = Math.min(
		parseInt(c.req.query("limit") ?? "20", 10),
		100,
	);

	// Build KV prefix: telemetry:{orgId}:{deviceId}:
	const kvKeyPrefix = `telemetry:${jwtPayload.org_id ?? ""}:${deviceIdentifier}:`;

	const kvListResult = await c.env.TELEMETRY_RAW.list({
		prefix: kvKeyPrefix,
		limit: maxEntries,
	});

	// Read each key from KV and deserialize JSON
	const collectedTelemetry: unknown[] = [];
	for (const kvKeyEntry of kvListResult.keys) {
		const rawKvValue = await c.env.TELEMETRY_RAW.get(kvKeyEntry.name);
		if (rawKvValue) {
			try {
				collectedTelemetry.push(JSON.parse(rawKvValue));
			} catch {
				// Skip corrupted or unparseable entries silently
			}
		}
	}

	// Sort by timestamp descending — most recent readings first
	collectedTelemetry.sort((a, b) => {
		const tsA = (a as Record<string, unknown>).timestamp as number;
		const tsB = (b as Record<string, unknown>).timestamp as number;
		return (tsB ?? 0) - (tsA ?? 0);
	});

	return c.json({
		deviceId: deviceIdentifier,
		entries: collectedTelemetry.slice(0, maxEntries),
		total: collectedTelemetry.length,
	});
});
