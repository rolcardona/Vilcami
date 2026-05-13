import { Hono } from "hono";
import type { Env } from "../types/env";
import { authMiddleware, orgScopingMiddleware } from "../middleware/auth.middleware";
import { requirePermission } from "../middleware/permission.middleware";
import { updatePermissionsValidator } from "../validators/member.validator";
import * as memberService from "../services/member-management.service";

export const memberRoutes = new Hono<{ Bindings: Env }>();

memberRoutes.use("*", authMiddleware);
memberRoutes.use("*", orgScopingMiddleware);

// GET / — list members of the organization (requires billing:manage permission)
memberRoutes.get("/", requirePermission("billing:manage"), async (c) => {
  const organizationFilter = c.get("organizationFilter") as string | null;
  const members = await memberService.listMembers(c.env, organizationFilter);
  return c.json({ members });
});

// PATCH /:memberId/permissions — update permissions for a user (requires billing:manage)
memberRoutes.patch("/:memberId/permissions", requirePermission("billing:manage"), async (c) => {
  const memberId = c.req.param("memberId")!;
  const organizationFilter = c.get("organizationFilter") as string | null;
  const requestBody = await c.req.json();
  const parsed = updatePermissionsValidator.safeParse(requestBody);

  if (!parsed.success) {
    return c.json({
      error: `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    }, 400);
  }

  const result = await memberService.updateMemberPermissions(
    c.env,
    memberId,
    parsed.data.permissions,
    organizationFilter,
  );

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({ success: true, memberId, permissions: parsed.data.permissions });
});