import { useState } from "react";
import { Header } from "@/components/layout/header";
import { GlassCard } from "@/components/layout/glass-card";
import { useDevices, useCreateDevice, useDeleteDevice } from "@/hooks/use-devices";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Cpu } from "lucide-react";

export function DevicesPage() {
  const { data: devices, isLoading } = useDevices();
  const createDevice = useCreateDevice();
  const deleteDevice = useDeleteDevice();
  const [showForm, setShowForm] = useState(false);

  return (
    <div>
      <Header title="Dispositivos" />
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-text-secondary text-sm">
            {devices ? `${devices.length} dispositivos` : "Cargando..."}
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            Nuevo dispositivo
          </button>
        </div>

        {isLoading ? (
          <GlassCard>
            <p className="text-text-muted text-center py-8">Cargando dispositivos...</p>
          </GlassCard>
        ) : devices && devices.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {devices.map((device, i) => (
              <GlassCard
                key={device.id}
                hover
                className={cn("animate-fade-in", `stagger-${Math.min(i + 1, 5)}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Cpu size={18} className="text-accent" />
                    <h3 className="font-semibold text-text-primary">{device.name}</h3>
                  </div>
                  <button
                    onClick={() => deleteDevice.mutate(device.id)}
                    className="p-1.5 rounded-lg hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="space-y-1 text-sm">
                  <p className="text-text-secondary">
                    Tipo: <span className="text-text-primary">{device.deviceType}</span>
                  </p>
                  <p className="text-text-secondary">
                    Protocolo: <span className="text-text-primary font-mono">{device.protocol}</span>
                  </p>
                  <p className="text-text-secondary">
                    Sensores: <span className="text-text-primary">{device.sensors?.length ?? 0}</span>
                  </p>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <span
                    className={cn("w-2 h-2 rounded-full", {
                      "bg-accent": device.status === "online",
                      "bg-text-muted": device.status === "offline",
                      "bg-warning": device.status === "maintenance",
                    })}
                  />
                  <span className={cn("text-xs capitalize", {
                    "text-accent": device.status === "online",
                    "text-text-muted": device.status === "offline",
                    "text-warning": device.status === "maintenance",
                  })}>
                    {device.status}
                  </span>
                </div>
              </GlassCard>
            ))}
          </div>
        ) : (
          <GlassCard>
            <div className="text-center py-12">
              <Cpu size={48} className="mx-auto text-text-muted mb-4" />
              <p className="text-text-secondary">No hay dispositivos registrados</p>
              <p className="text-text-muted text-sm mt-1">Crea tu primer dispositivo para comenzar</p>
            </div>
          </GlassCard>
        )}

        {showForm && (
          <CreateDeviceModal
            onSubmit={async (data) => {
              await createDevice.mutateAsync(data);
              setShowForm(false);
            }}
            onClose={() => setShowForm(false)}
          />
        )}
      </div>
    </div>
  );
}

function CreateDeviceModal({
  onSubmit,
  onClose,
}: {
  onSubmit: (data: { name: string; deviceType: string; protocol: string; location?: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [deviceType, setDeviceType] = useState("refrigerator");
  const [protocol, setProtocol] = useState("tuya");
  const [location, setLocation] = useState("");

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <GlassCard variant="strong" className="w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-text-primary mb-4">Nuevo dispositivo</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ name, deviceType, protocol, location: location || undefined });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg bg-surface border border-white/10 text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none transition-colors"
              placeholder="Camara fria 01"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">Tipo</label>
            <select
              value={deviceType}
              onChange={(e) => setDeviceType(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-surface border border-white/10 text-text-primary focus:border-accent/50 focus:outline-none transition-colors"
            >
              <option value="refrigerator">Refrigerador</option>
              <option value="freezer">Freezer</option>
              <option value="cold_room">Camara fria</option>
              <option value="sensor">Sensor independiente</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">Protocolo</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-surface border border-white/10 text-text-primary focus:border-accent/50 focus:outline-none transition-colors"
            >
              <option value="tuya">Tuya</option>
              <option value="modbus">Modbus/RS485</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1.5">Ubicacion (opcional)</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-surface border border-white/10 text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none transition-colors"
              placeholder="Deposito A, Estante 3"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg bg-surface-elevated border border-white/10 text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors"
            >
              Crear
            </button>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}