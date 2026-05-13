import { useState } from "react";
import { Header } from "@/components/layout/header";
import { GlassCard } from "@/components/layout/glass-card";
import { useAlerts, useActiveAlertCount, useAcknowledgeAlert, useResolveAlert } from "@/hooks/use-alerts";
import { SEVERITY, type Severity } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle, Clock, Shield } from "lucide-react";

export function AlertsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const { data: alertsData, isLoading } = useAlerts({
    status: statusFilter || undefined,
    severity: (severityFilter || undefined) as Severity | undefined,
  });
  const { data: alertCount } = useActiveAlertCount();
  const acknowledge = useAcknowledgeAlert();
  const resolve = useResolveAlert();

  const alerts = alertsData?.alerts ?? [];

  return (
    <div>
      <Header title="Alertas" />
      <div className="p-8 space-y-6">
        {alertCount && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in">
            {(["critical", "high", "medium", "low"] as const).map((sev) => (
              <GlassCard key={sev} hover className="stagger-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("w-2 h-2 rounded-full", SEVERITY[sev].dot)} />
                  <p className="text-sm text-text-secondary">{SEVERITY[sev].label}</p>
                </div>
                <p className={cn("text-2xl font-bold font-mono", SEVERITY[sev].color)}>
                  {alertCount[sev] ?? 0}
                </p>
              </GlassCard>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-surface border border-white/10 text-text-primary text-sm focus:border-accent/50 focus:outline-none"
          >
            <option value="">Todos los estados</option>
            <option value="active">Activas</option>
            <option value="acknowledged">Reconocidas</option>
            <option value="resolved">Resueltas</option>
            <option value="shelved">Pospuestas</option>
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="px-3 py-2 rounded-lg bg-surface border border-white/10 text-text-primary text-sm focus:border-accent/50 focus:outline-none"
          >
            <option value="">Todas las severidades</option>
            <option value="critical">Critico</option>
            <option value="high">Alto</option>
            <option value="medium">Medio</option>
            <option value="low">Bajo</option>
          </select>
        </div>

        {isLoading ? (
          <GlassCard>
            <p className="text-text-muted text-center py-8">Cargando alertas...</p>
          </GlassCard>
        ) : alerts.length > 0 ? (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <GlassCard key={alert.id} hover className="animate-fade-in">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn("w-2 h-2 rounded-full", SEVERITY[alert.severity as Severity]?.dot)} />
                      <span className={cn("text-xs font-medium uppercase tracking-wide", SEVERITY[alert.severity as Severity]?.color)}>
                        {SEVERITY[alert.severity as Severity]?.label}
                      </span>
                      <span className="text-text-muted text-xs">·</span>
                      <span className="text-text-muted text-xs capitalize">{alert.status}</span>
                    </div>
                    <h3 className="font-semibold text-text-primary">{alert.title}</h3>
                    <p className="text-sm text-text-secondary mt-1">{alert.message}</p>
                    <p className="text-xs text-text-muted mt-2">
                      {new Date(alert.createdAt).toLocaleString("es")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {alert.status === "active" && (
                      <button
                        onClick={() => acknowledge.mutate({ id: alert.id, notes: "Reconocida desde dashboard" })}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-warning/10 border border-warning/20 text-warning text-xs font-medium hover:bg-warning/20 transition-colors"
                      >
                        <CheckCircle size={12} />
                        Reconocer
                      </button>
                    )}
                    {(alert.status === "active" || alert.status === "acknowledged") && (
                      <button
                        onClick={() => resolve.mutate({ id: alert.id, notes: "Resuelta desde dashboard" })}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-xs font-medium hover:bg-accent/20 transition-colors"
                      >
                        <Shield size={12} />
                        Resolver
                      </button>
                    )}
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        ) : (
          <GlassCard>
            <div className="text-center py-12">
              <AlertTriangle size={48} className="mx-auto text-text-muted mb-4" />
              <p className="text-text-secondary">No hay alertas</p>
              <p className="text-text-muted text-sm mt-1">Todo funciona correctamente</p>
            </div>
          </GlassCard>
        )}
      </div>
    </div>
  );
}