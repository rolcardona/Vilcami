import { useState } from "react";
import { supabase } from "@/auth/supabase";
import { GlassCard } from "@/components/layout/glass-card";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSignUp, setIsSignUp] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isSignUp) {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de autenticacion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8 animate-fade-in">
          <h1 className="text-3xl font-bold font-mono text-text-primary tracking-tight">
            VILCAMI
          </h1>
          <p className="text-text-secondary mt-2">Industrial IoT Monitor</p>
        </div>

        <GlassCard variant="strong" className="animate-fade-in stagger-1">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-lg font-semibold text-text-primary">
              {isSignUp ? "Crear cuenta" : "Iniciar sesion"}
            </h2>

            {error && (
              <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm text-text-secondary mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg bg-surface border border-white/10 text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none transition-colors"
                placeholder="tu@empresa.com"
              />
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1.5">
                Contrasena
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-lg bg-surface border border-white/10 text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition-colors disabled:opacity-50"
            >
              {loading ? "Cargando..." : isSignUp ? "Crear cuenta" : "Entrar"}
            </button>

            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
              className="w-full text-sm text-text-secondary hover:text-accent transition-colors"
            >
              {isSignUp ? "Ya tengo cuenta" : "No tengo cuenta"}
            </button>
          </form>
        </GlassCard>
      </div>
    </div>
  );
}