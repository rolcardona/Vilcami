import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { alertsApi, type AlertsListParams } from "@/api/alerts";

export function useAlerts(params?: AlertsListParams) {
  return useQuery({
    queryKey: ["alerts", params],
    queryFn: () => alertsApi.list(params),
  });
}

export function useActiveAlertCount() {
  return useQuery({
    queryKey: ["alerts", "active-count"],
    queryFn: () => alertsApi.activeCount(),
    refetchInterval: 60_000,
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) => alertsApi.acknowledge(id, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}

export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) => alertsApi.resolve(id, notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
}