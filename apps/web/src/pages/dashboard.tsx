import { Header } from "@/components/layout/header";
import { GlassCard } from "@/components/layout/glass-card";

export function DashboardPage() {
  return (
    <div>
      <Header title="Dashboard" />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {METRICS.map((m) => (
            <GlassCard key={m.label} hover className="animate-fade-in">
              <p className="text-sm text-text-secondary">{m.label}</p>
              <p className="text-2xl font-bold font-mono text-text-primary mt-1">
                {m.value}
              </p>
              <p className="text-xs text-text-muted mt-1">{m.unit}</p>
            </GlassCard>
          ))}
        </div>

        <GlassCard className="animate-fade-in stagger-2">
          <h3 className="text-sm font-medium text-text-secondary mb-4">
            Telemetria en tiempo real
          </h3>
          <div className="h-64 flex items-center justify-center border border-dashed border-white/10 rounded-lg text-text-muted">
            Conectando al backend...
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

const METRICS = [
  { label: "Temperatura", value: "—", unit: "°C" },
  { label: "Humedad", value: "—", unit: "%" },
  { label: "Dispositivos activos", value: "—", unit: "" },
  { label: "Alertas activas", value: "—", unit: "" },
];