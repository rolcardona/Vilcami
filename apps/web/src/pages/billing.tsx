import { Header } from "@/components/layout/header";
import { GlassCard } from "@/components/layout/glass-card";
import { usePlans, useSubscription, usePayments, useCheckout } from "@/hooks/use-billing";
import { PLAN_LABELS, type PlanName } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Check, CreditCard, Infinity } from "lucide-react";

export function BillingPage() {
  const { data: plans } = usePlans();
  const { data: subscription } = useSubscription();
  const { data: paymentsData } = usePayments();
  const checkout = useCheckout();

  const currentPlan = subscription?.planName ?? "trial";
  const payments = paymentsData?.payments ?? [];

  return (
    <div>
      <Header title="Billing" />
      <div className="p-8 space-y-8">
        {subscription && (
          <GlassCard className="animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">Plan actual</p>
                <p className="text-2xl font-bold text-accent capitalize">
                  {PLAN_LABELS[currentPlan as PlanName] ?? currentPlan}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-text-secondary">Dispositivos</p>
                <p className="text-lg font-mono text-text-primary">
                  {subscription.deviceCount} / {subscription.maxDevices === Infinity ? "∞" : subscription.maxDevices}
                </p>
              </div>
              <div className={cn("text-right", {
                "text-accent": subscription.status === "active",
                "text-info": subscription.status === "trial",
                "text-warning": subscription.status === "past_due",
                "text-danger": subscription.status === "suspended",
                "text-text-muted": subscription.status === "cancelled",
              })}>
                <p className="text-sm text-text-secondary">Estado</p>
                <p className="text-lg font-semibold capitalize">{subscription.status.replace("_", " ")}</p>
              </div>
            </div>
          </GlassCard>
        )}

        <div>
          <h3 className="text-lg font-semibold text-text-primary mb-4">Planes disponibles</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans?.map((plan, i) => (
              <GlassCard
                key={plan.name}
                hover
                className={cn("animate-fade-in relative", `stagger-${i + 1}`, plan.name === currentPlan && "border-accent/30")}
              >
                {plan.name === currentPlan && (
                  <div className="absolute -top-px -right-px bg-accent text-white text-xs font-bold px-2 py-0.5 rounded-bl-lg rounded-tr-[11px]">
                    Actual
                  </div>
                )}
                <div className="mb-4">
                  <p className="text-lg font-semibold text-text-primary">{plan.label}</p>
                  <p className="text-2xl font-bold font-mono text-text-primary mt-1">
                    {plan.priceInCents === 0 ? "Gratis" : `$${(plan.priceInCents / 100).toLocaleString("es-CO")}`}
                  </p>
                </div>
                <div className="space-y-2 text-sm">
                  <Feature icon={Cpu} label={`${plan.maxDevices === 2147483647 ? "Ilimitados" : plan.maxDevices} dispositivos`} />
                  <Feature icon={Infinity} label={`${plan.readingsPerHour === 2147483647 ? "Ilimitadas" : plan.readingsPerHour.toLocaleString()} lecturas/hora`} />
                  <Feature icon={Check} label={`${plan.dataRetentionDays === 2147483647 ? "Ilimitada" : `${plan.dataRetentionDays} dias`} retencion`} />
                </div>
                {plan.name !== currentPlan && (
                  <button
                    onClick={() =>
                      checkout.mutate({
                        planId: plan.name,
                        deviceCount: subscription?.deviceCount ?? 1,
                        returnUrl: window.location.origin + "/billing",
                      })
                    }
                    className="w-full mt-4 py-2 rounded-lg bg-accent/10 border border-accent/20 text-accent text-sm font-medium hover:bg-accent/20 transition-colors"
                  >
                    {plan.priceInCents === 0 ? "Plan basico" : "Cambiar plan"}
                  </button>
                )}
              </GlassCard>
            ))}
          </div>
        </div>

        {payments.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold text-text-primary mb-4">Historial de pagos</h3>
            <GlassCard>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="text-left text-text-muted font-medium pb-3">Fecha</th>
                      <th className="text-left text-text-muted font-medium pb-3">Plan</th>
                      <th className="text-right text-text-muted font-medium pb-3">Monto</th>
                      <th className="text-right text-text-muted font-medium pb-3">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-b border-white/5 last:border-0">
                        <td className="py-3 text-text-primary">{new Date(p.createdAt).toLocaleDateString("es")}</td>
                        <td className="py-3 text-text-secondary capitalize">{p.planId}</td>
                        <td className="py-3 text-text-primary font-mono text-right">
                          ${(p.amountInCents / 100).toLocaleString("es-CO")}
                        </td>
                        <td className="py-3 text-right">
                          <span className={cn("px-2 py-0.5 rounded text-xs font-medium", {
                            "bg-accent/10 text-accent": p.status === "completed",
                            "bg-warning/10 text-warning": p.status === "pending",
                            "bg-danger/10 text-danger": p.status === "failed",
                            "bg-surface-elevated text-text-muted": p.status === "refunded",
                          })}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>
          </div>
        )}
      </div>
    </div>
  );
}

function Feature({ icon: Icon, label }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-2 text-text-secondary">
      <Icon size={14} className="text-accent" />
      <span>{label}</span>
    </div>
  );
}