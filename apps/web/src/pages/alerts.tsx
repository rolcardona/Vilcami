import { Header } from "@/components/layout/header";
import { GlassCard } from "@/components/layout/glass-card";

export function AlertsPage() {
  return (
    <div>
      <Header title="Alertas" />
      <div className="p-8">
        <GlassCard>
          <p className="text-text-secondary">Alertas y notificaciones — conectando al backend...</p>
        </GlassCard>
      </div>
    </div>
  );
}