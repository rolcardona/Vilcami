import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/auth/auth-provider";
import { LogOut } from "lucide-react";

export function Header({ title }: { title: string }) {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <header className="flex items-center justify-between px-8 py-4 border-b border-white/5">
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-3 hover:bg-surface-elevated rounded-lg px-2 py-1 transition-colors"
        >
          <span className="text-sm text-text-secondary">
            {user?.email ?? ""}
          </span>
          <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-accent text-xs font-bold">
            {(user?.email?.[0] ?? "?").toUpperCase()}
          </div>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-2 w-48 bg-surface border border-white/10 rounded-lg shadow-xl z-50">
            <button
              onClick={() => { signOut(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-4 py-3 text-sm text-text-secondary hover:text-danger hover:bg-danger/5 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Cerrar sesion
            </button>
          </div>
        )}
      </div>
    </header>
  );
}