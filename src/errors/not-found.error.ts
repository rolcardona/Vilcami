/**
 * NotFoundError — thrown when a requested resource does not exist.
 * Used by services to signal missing records so callers can handle
 * the absence gracefully (skip, return 404, etc.) instead of
 * propagating null values.
 */
export class NotFoundError extends Error {
  /** The type of resource that was not found (e.g. "Subscription", "Organization") */
  public readonly resourceType: string;
  /** The identifier that was looked up */
  public readonly resourceId: string;

  constructor(resourceType: string, resourceId: string) {
    super(`${resourceType} not found: ${resourceId}`);
    this.name = "NotFoundError";
    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }
}