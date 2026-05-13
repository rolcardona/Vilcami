import { Header } from "@/components/layout/header";
import { GlassCard } from "@/components/layout/glass-card";

export function BillingPage() {
  return (
    <div>
      <Header title="Billing" />
      <div className="p-8">
        <GlassCard>
          <p className="text-text-secondary">Planes y suscripciones — conectando al backend...</p>
        </GlassCard>
      </div>
    </div>
  );
}