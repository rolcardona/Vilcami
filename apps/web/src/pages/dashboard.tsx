import { Header } from "@/components/layout/header";
import { GlassCard } from "@/components/layout/glass-card";
import { useDevices } from "@/hooks/use-devices";
import { useActiveAlertCount } from "@/hooks/use-alerts";
import { useSubscription } from "@/hooks/use-billing";
import { cn } from "@/lib/utils";
import { Thermometer, Droplets, Cpu, AlertTriangle } from "lucide-react";

export function DashboardPage() {
  const { data: devices, isLoading: loadingDevices } = useDevices();
  const { data: alertCount, isLoading: loadingAlerts } = useActiveAlertCount();
  const { data: subscription, isLoading: loadingSub } = useSubscription();

  const onlineDevices = devices?.filter((d) => d.status === "online").length ?? 0;
  const totalAlerts =
    (alertCount?.critical ?? 0) +
    (alertCount?.high ?? 0) +
    (alertCount?.medium ?? 0) +
    (alertCount?.low ?? 0);

  return (
    <div>
      <Header title="Dashboard" />
      <div className="p-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={Thermometer}
            label="Temperatura"
            value="—"
            unit="°C"
            loading={loadingDevices}
            delay={1}
          />
          <MetricCard
            icon={Droplets}
            label="Humedad"
            value="—"
            unit="%"
            loading={loadingDevices}
            delay={2}
          />
          <MetricCard
            icon={Cpu}
            label="Dispositivos activos"
            value={String(onlineDevices)}
            unit={`/ ${devices?.length ?? 0}`}
            loading={loadingDevices}
            delay={3}
          />
          <MetricCard
            icon={AlertTriangle}
            label="Alertas activas"
            value={String(totalAlerts)}
            unit=""
            loading={loadingAlerts}
            delay={4}
            accent={totalAlerts > 0 ? "danger" : undefined}
          />
        </div>

        {subscription && (
          <GlassCard className="animate-fade-in stagger-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Plan actual</p>
                <p className="text-lg font-semibold text-accent capitalize">
                  {subscription.planName}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-text-secondary">Dispositivos</p>
                <p className="text-lg font-mono text-text-primary">
                  {subscription.deviceCount} / {subscription.maxDevices === Infinity ? "∞" : subscription.maxDevices}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-text-secondary">Estado</p>
                <p className={cn("text-lg font-semibold capitalize", {
                  "text-accent": subscription.status === "active",
                  "text-info": subscription.status === "trial",
                  "text-warning": subscription.status === "past_due",
                  "text-danger": subscription.status === "suspended",
                  "text-text-muted": subscription.status === "cancelled",
                })}>
                  {subscription.status.replace("_", " ")}
                </p>
              </div>
            </div>
          </GlassCard>
        )}

        <GlassCard className="animate-fade-in stagger-5">
          <h3 className="text-sm font-medium text-text-secondary mb-4">
            Telemetria en tiempo real
          </h3>
          <div className="h-64 flex items-center justify-center border border-dashed border-white/10 rounded-lg text-text-muted">
            {loadingDevices ? "Cargando..." : "Selecciona un dispositivo para ver telemetria"}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  loading,
  delay,
  accent,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  unit: string;
  loading: boolean;
  delay: number;
  accent?: "danger" | "warning";
}) {
  const colorMap = {
    danger: "text-danger",
    warning: "text-warning",
  };
  return (
    <GlassCard hover className={cn("animate-fade-in", `stagger-${delay}`)}>
      <div className="flex items-center gap-3 mb-2">
        <div className={cn("p-2 rounded-lg", accent ? `bg-${accent}/10` : "bg-accent/10")}>
          <Icon size={16} className={accent ? colorMap[accent] : "text-accent"} />
        </div>
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
      <p className={cn("text-2xl font-bold font-mono text-text-primary mt-1", accent && colorMap[accent])}>
        {loading ? "—" : value}
      </p>
      {unit && <p className="text-xs text-text-muted mt-1">{unit}</p>}
    </GlassCard>
  );
}