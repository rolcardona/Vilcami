import type { DeviceAdapter } from "./device-adapter.interface";
import { SimulatedDeviceProvider } from "./simulated-device.provider";

/**
 * Factory that returns the appropriate DeviceAdapter implementation.
 *
 * Currently always returns SimulatedDeviceProvider for development.
 * When real Tuya/Modbus adapters are implemented in future phases,
 * this factory will inspect config or env flags to decide.
 */
export function createDeviceAdapter(
  protocolType: "tuya" | "modbus" | "simulated",
  _config?: Record<string, unknown>,
): DeviceAdapter {
  // All protocol types return the simulator in development mode.
  // In production, switch based on protocolType + config flags.
  return new SimulatedDeviceProvider();
}
