import { Header } from "@/components/layout/header";
import { GlassCard } from "@/components/layout/glass-card";

export function DevicesPage() {
  return (
    <div>
      <Header title="Dispositivos" />
      <div className="p-8">
        <GlassCard>
          <p className="text-text-secondary">Gestion de dispositivos — conectando al backend...</p>
        </GlassCard>
      </div>
    </div>
  );
}