import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDrizzleDb } from "../../utils/db.util";

vi.mock("../../utils/db.util", () => {
  const mockDb: Record<string, ReturnType<typeof vi.fn>> = {};
  mockDb.select = vi.fn(() => mockDb);
  mockDb.from = vi.fn(() => mockDb);
  mockDb.where = vi.fn(() => mockDb);
  mockDb.all = vi.fn(() => Promise.resolve([]));
  mockDb.get = vi.fn(() => Promise.resolve(null));
  mockDb.insert = vi.fn(() => mockDb);
  mockDb.values = vi.fn(() => mockDb);
  mockDb.returning = vi.fn(() => mockDb);
  mockDb.update = vi.fn(() => mockDb);
  mockDb.set = vi.fn(() => mockDb);
  mockDb.delete = vi.fn(() => mockDb);
  return { getDrizzleDb: () => mockDb };
});

vi.mock("../../adapters/device-adapter.factory", () => ({ createDeviceAdapter: vi.fn() }));

describe("Device Management Service", () => {
  let mockEnv: any; let adapter: any; let factoryFn: any; let mockDb: any;
  let listDevices: any; let getDevice: any; let createDevice: any;
  let updateDevice: any; let deleteDevice: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEnv = {};
    mockDb = getDrizzleDb(mockEnv);
    mockDb.all = vi.fn();
    mockDb.get = vi.fn();

    adapter = { connect: vi.fn().mockResolvedValue({ success: true }), disconnect: vi.fn().mockResolvedValue(undefined) };
    const factoryMod = await import("../../adapters/device-adapter.factory");
    factoryFn = factoryMod.createDeviceAdapter;
    factoryFn.mockReturnValue(adapter);

    const svc = await import("../../services/device-management.service");
    listDevices = svc.listDevices; getDevice = svc.getDevice;
    createDevice = svc.createDevice; updateDevice = svc.updateDevice;
    deleteDevice = svc.deleteDevice;
  });

  function makeDevice(o: Record<string, any> = {}) {
    return { id: "dev-001", organizationId: "org-001", name: "Sensor Frio Camara 3",
      deviceExternalId: "ext-abc-123", protocolType: "modbus", location: "Camara Frigorifica 3",
      latitude: -34.6037, longitude: -58.3816, status: "offline", lastSeenAt: null,
      createdAt: new Date("2025-01-15T10:00:00Z"), ...o };
  }

  describe("listDevices", () => {
    it("returns all devices when filter is null (admin)", async () => {
      mockDb.all = vi.fn().mockResolvedValue([makeDevice({ id: "dev-001" }), makeDevice({ id: "dev-002", organizationId: "org-002" })]);
      const r = await listDevices(mockEnv, null);
      expect(r.total).toBe(2);
      expect(r.devices).toHaveLength(2);
      expect(mockDb.where).not.toHaveBeenCalled();
      expect(mockDb.all).toHaveBeenCalledOnce();
    });

    it("returns org-filtered devices when filter is set", async () => {
      mockDb.all = vi.fn().mockResolvedValue([makeDevice()]);
      const r = await listDevices(mockEnv, "org-001");
      expect(r.total).toBe(1);
      expect(mockDb.where).toHaveBeenCalledOnce();
    });
  });

  describe("getDevice", () => {
    it("returns single device by id", async () => {
      mockDb.get = vi.fn().mockResolvedValue(makeDevice());
      const r = await getDevice(mockEnv, "dev-001", "org-001");
      expect(r.device).toBeDefined();
      expect(r.device.id).toBe("dev-001");
      expect(mockDb.where).toHaveBeenCalledOnce();
    });

    it("returns null for non-existent device", async () => {
      mockDb.get = vi.fn().mockResolvedValue(undefined);
      const r = await getDevice(mockEnv, "dev-nonexistent", "org-001");
      expect(r.device).toBeNull();
    });
  });

  describe("createDevice", () => {
    it("validates, inserts device + 3 sensors, connects adapter", async () => {
      mockDb.get = vi.fn().mockResolvedValue(makeDevice({ id: "dev-new", name: "Nueva Camara" }));
      const input = { organizationId: "org-001", name: "Nueva Camara",
        deviceExternalId: "ext-new-001", protocolType: "modbus", location: "Sotano 2" };
      const r = await createDevice(mockEnv, input, "org-001");
      expect(r.success).toBe(true);
      expect(r.device.name).toBe("Nueva Camara");
      expect(mockDb.insert).toHaveBeenCalledTimes(4);
      expect(factoryFn).toHaveBeenCalledWith("modbus");
      expect(adapter.connect).toHaveBeenCalledWith(expect.any(String));
    });

    it("rejects invalid input", async () => {
      const r = await createDevice(mockEnv, { name: "" }, "org-001");
      expect(r.success).toBe(false);
      expect(r.error).toBeDefined();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(adapter.connect).not.toHaveBeenCalled();
    });
  });

  describe("updateDevice", () => {
    it("updates provided fields, preserves others", async () => {
      mockDb.get = vi.fn().mockResolvedValue(makeDevice());
      const r = await updateDevice(mockEnv, "dev-001",
        { name: "Actualizado", location: "Nueva Ubicacion" }, "org-001");
      expect(r.success).toBe(true);
      expect(r.device.name).toBe("Actualizado");
      expect(r.device.location).toBe("Nueva Ubicacion");
      expect(r.device.protocolType).toBe("modbus");
      expect(mockDb.update).toHaveBeenCalledOnce();
      expect(mockDb.set).toHaveBeenCalledWith({ name: "Actualizado", location: "Nueva Ubicacion" });
    });

    it("rejects when device not found", async () => {
      mockDb.get = vi.fn().mockResolvedValue(undefined);
      const r = await updateDevice(mockEnv, "dev-nonexistent", { name: "X" }, "org-001");
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not found/i);
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteDevice", () => {
    it("deletes sensors, device, disconnects adapter", async () => {
      mockDb.get = vi.fn().mockResolvedValue(makeDevice());
      const r = await deleteDevice(mockEnv, "dev-001", "org-001");
      expect(r.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalledTimes(2);
      expect(adapter.disconnect).toHaveBeenCalledWith("dev-001");
    });

    it("returns error for non-existent device", async () => {
      mockDb.get = vi.fn().mockResolvedValue(undefined);
      const r = await deleteDevice(mockEnv, "dev-nonexistent", "org-001");
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not found/i);
      expect(mockDb.delete).not.toHaveBeenCalled();
      expect(adapter.disconnect).not.toHaveBeenCalled();
    });
  });
});
