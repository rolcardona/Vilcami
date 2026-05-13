export const SEVERITY = {
  critical: { label: "Critico", color: "text-danger", bg: "bg-danger/10", dot: "bg-danger" },
  high: { label: "Alto", color: "text-warning", bg: "bg-warning/10", dot: "bg-warning" },
  medium: { label: "Medio", color: "text-info", bg: "bg-info/10", dot: "bg-info" },
  low: { label: "Bajo", color: "text-text-secondary", bg: "bg-surface-elevated", dot: "bg-text-muted" },
} as const;

export type Severity = keyof typeof SEVERITY;

export const PLAN_NAMES = ["trial", "starter", "professional", "enterprise"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export const PLAN_LABELS: Record<PlanName, string> = {
  trial: "Prueba",
  starter: "Starter",
  professional: "Profesional",
  enterprise: "Empresa",
};

export const SUBSCRIPTION_STATUS = {
  trial: { label: "Prueba", color: "text-info" },
  active: { label: "Activa", color: "text-accent" },
  past_due: { label: "Vencida", color: "text-warning" },
  suspended: { label: "Suspendida", color: "text-danger" },
  cancelled: { label: "Cancelada", color: "text-text-muted" },
} as const;

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "/api";