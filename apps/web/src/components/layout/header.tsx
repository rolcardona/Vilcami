import { useAuth } from "@/auth/auth-provider";

export function Header({ title }: { title: string }) {
  const { user } = useAuth();

  return (
    <header className="flex items-center justify-between px-8 py-4 border-b border-white/5">
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      <div className="flex items-center gap-3">
        <span className="text-sm text-text-secondary">
          {user?.email ?? ""}
        </span>
        <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-accent text-xs font-bold">
          {(user?.email?.[0] ?? "?").toUpperCase()}
        </div>
      </div>
    </header>
  );
}