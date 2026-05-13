import { useQuery } from "@tanstack/react-query";
import { telemetryApi } from "@/api/telemetry";

export function useTelemetry(deviceId: string, limit = 100) {
  return useQuery({
    queryKey: ["telemetry", deviceId, limit],
    queryFn: () => telemetryApi.getRecent(deviceId, limit),
    refetchInterval: 30_000,
  });
}