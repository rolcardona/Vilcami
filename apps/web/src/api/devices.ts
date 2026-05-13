import { api } from "./client";

export interface Device {
  id: string;
  organizationId: string;
  name: string;
  deviceType: string;
  protocol: string;
  status: "online" | "offline" | "maintenance";
  location: string | null;
  createdAt: string;
  updatedAt: string;
  sensors: DeviceSensor[];
}

export interface DeviceSensor {
  id: string;
  deviceId: string;
  sensorType: string;
  unit: string;
  minThreshold: number | null;
  maxThreshold: number | null;
}

export interface CreateDevicePayload {
  name: string;
  deviceType: string;
  protocol: string;
  location?: string;
}

export const devicesApi = {
  list: () => api.get("devices").json<Device[]>(),
  get: (id: string) => api.get(`devices/${id}`).json<Device>(),
  create: (data: CreateDevicePayload) => api.post("devices", { json: data }).json<Device>(),
  update: (id: string, data: Partial<CreateDevicePayload>) => api.patch(`devices/${id}`, { json: data }).json<Device>(),
  delete: (id: string) => api.delete(`devices/${id}`),
};