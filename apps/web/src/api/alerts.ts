import { api } from "./client";

export interface Alert {
  id: string;
  organizationId: string;
  deviceId: string | null;
  ruleId: string | null;
  severity: "critical" | "high" | "medium" | "low";
  status: "active" | "acknowledged" | "resolved" | "shelved";
  title: string;
  message: string;
  aiContext: Record<string, unknown> | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertsListParams {
  page?: number;
  limit?: number;
  severity?: string;
  status?: string;
  deviceId?: string;
}

export interface ActiveAlertCount {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export const alertsApi = {
  list: (params?: AlertsListParams) =>
    api.get("alerts", { searchParams: params as Record<string, string> }).json<{ alerts: Alert[]; total: number }>(),
  get: (id: string) => api.get(`alerts/${id}`).json<Alert>(),
  activeCount: () => api.get("alerts/active/count").json<ActiveAlertCount>(),
  acknowledge: (id: string, notes: string) =>
    api.patch(`alerts/${id}/acknowledge`, { json: { acknowledgmentNotes: notes } }).json<Alert>(),
  resolve: (id: string, notes: string) =>
    api.patch(`alerts/${id}/resolve`, { json: { resolutionNotes: notes } }).json<Alert>(),
  shelve: (id: string, untilTimestamp: string, reason: string) =>
    api.post(`alerts/${id}/shelve`, { json: { shelvedUntilTimestamp: untilTimestamp, shelvingReason: reason } }).json<Alert>(),
};