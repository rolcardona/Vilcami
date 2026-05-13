import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { devicesApi, type CreateDevicePayload } from "@/api/devices";

export function useDevices() {
  return useQuery({ queryKey: ["devices"], queryFn: () => devicesApi.list() });
}

export function useDevice(id: string) {
  return useQuery({ queryKey: ["devices", id], queryFn: () => devicesApi.get(id) });
}

export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDevicePayload) => devicesApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
}

export function useUpdateDevice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CreateDevicePayload>) => devicesApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
}

export function useDeleteDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => devicesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });
}