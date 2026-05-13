import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Cpu,
  Bell,
  CreditCard,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/auth/auth-provider";
import { useActiveAlertCount } from "@/hooks/use-alerts";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/devices", icon: Cpu, label: "Dispositivos" },
  { to: "/alerts", icon: Bell, label: "Alertas" },
  { to: "/billing", icon: CreditCard, label: "Billing" },
] as const;

export function Sidebar() {
  const { user, signOut } = useAuth();
  const { data: alertCount } = useActiveAlertCount();

  const totalAlerts =
    (alertCount?.critical ?? 0) +
    (alertCount?.high ?? 0) +
    (alertCount?.medium ?? 0) +
    (alertCount?.low ?? 0);

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 glass-strong flex flex-col p-4 z-50">
      <div className="mb-8 px-2">
        <h1 className="text-xl font-bold text-text-primary tracking-tight font-mono">
          VILCAMI
        </h1>
        <p className="text-xs text-text-muted mt-1">Industrial IoT Monitor</p>
      </div>

      <nav className="flex-1 flex flex-col gap-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors relative",
                isActive
                  ? "bg-accent/10 text-accent border border-accent/20"
                  : "text-text-secondary hover:text-text-primary hover:bg-white/5"
              )
            }
          >
            <Icon size={18} />
            {label}
            {to === "/alerts" && totalAlerts > 0 && (
              <span className="ml-auto px-1.5 py-0.5 rounded-full bg-danger text-white text-xs font-bold min-w-[20px] text-center">
                {totalAlerts}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/5 pt-4 mt-2">
        <div className="px-3 mb-3">
          <p className="text-sm text-text-primary truncate">
            {user?.email ?? "—"}
          </p>
          <p className="text-xs text-text-muted">Organizacion</p>
        </div>
        <button
          onClick={signOut}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:text-danger hover:bg-danger/5 transition-colors"
        >
          <LogOut size={18} />
          Cerrar sesion
        </button>
      </div>
    </aside>
  );
}