/**
 * Tipos e interfaz principal para adaptadores de protocolo IoT.
 *
 * Todos los adaptadores de protocolo (Tuya, Modbus/RS485, etc.) deben
 * implementar la interfaz DeviceAdapter para garantizar un contrato
 * uniforme de conexion, telemetria y comandos.
 */

// ---------------------------------------------------------------------------
// Tipos de apoyo
// ---------------------------------------------------------------------------

/** Informacion de un sensor individual reportado por un dispositivo. */
export interface SensorInfo {
	sensorId: string;
	sensorType: string; // e.g., "temperature", "humidity", "pressure"
	unit: string; // e.g., "Celsius", "percent", "hectopascal"
	currentValue?: number;
}

/** Informacion completa de un dispositivo fisico/logico. */
export interface DeviceInfo {
	deviceId: string;
	protocolType: string;
	status: string;
	sensors: SensorInfo[];
}

/** Resultado de la operacion connect(). */
export interface DeviceConnectionResult {
	success: boolean;
	deviceInfo?: DeviceInfo;
	errorMessage?: string;
}

/**
 * Lectura de telemetria proveniente de un sensor del dispositivo.
 * La forma coincide con telemetryValidator (src/validators/telemetry.validator.ts)
 * excepto por organizationId, que se inyecta en la capa de servicio.
 */
export interface DeviceTelemetry {
	deviceId: string;
	sensorId: string;
	value: number;
	unit: string;
	timestamp: number; // Unix epoch en milisegundos
	metadata?: Record<string, unknown>;
}

/** Comando que se envia a un dispositivo (setpoint, reinicio, calibracion, etc.). */
export interface DeviceCommand {
	commandType: string; // e.g., "setSetpoint", "reboot", "calibrate"
	parameters: Record<string, unknown>;
}

/** Resultado de la operacion sendCommand(). */
export interface DeviceCommandResult {
	success: boolean;
	payload?: unknown;
	errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Interfaz principal
// ---------------------------------------------------------------------------

/**
 * Contrato que todo adaptador de protocolo IoT debe implementar.
 *
 * Garantiza operaciones uniformes de conexion, desconexion,
 * captura de telemetria, envio de comandos y consulta de informacion.
 */
export interface DeviceAdapter {
	connect(
		deviceId: string,
		credentials?: Record<string, unknown>,
	): Promise<DeviceConnectionResult>;

	disconnect(deviceId: string): Promise<void>;

	fetchTelemetry(
		deviceId: string,
		sensorIds?: string[],
	): Promise<DeviceTelemetry[]>;

	sendCommand(
		deviceId: string,
		command: DeviceCommand,
	): Promise<DeviceCommandResult>;

	getDeviceInfo(deviceId: string): Promise<DeviceInfo>;
}
