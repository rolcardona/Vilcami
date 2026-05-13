import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import type { User, Session } from "@supabase/supabase-js";
import { membersApi } from "@/api/members";
import type { Permission, Role } from "@/lib/constants";
import { DEFAULT_USER_PERMISSIONS } from "@/lib/constants";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: Role | null;
  permissions: Permission[];
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  role: null,
  permissions: DEFAULT_USER_PERMISSIONS,
  signOut: async () => {},
});

async function fetchMyPermissions(): Promise<{ role: Role; permissions: Permission[] }> {
  try {
    const data = await membersApi.getMyPermissions();
    return { role: data.role as Role, permissions: data.permissions };
  } catch {
    return { role: "user", permissions: DEFAULT_USER_PERMISSIONS };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>(DEFAULT_USER_PERMISSIONS);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        const { role: r, permissions: p } = await fetchMyPermissions();
        setRole(r);
        setPermissions(p);
      } else {
        setRole(null);
        setPermissions(DEFAULT_USER_PERMISSIONS);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, s) => {
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          const { role: r, permissions: p } = await fetchMyPermissions();
          setRole(r);
          setPermissions(p);
        } else {
          setRole(null);
          setPermissions(DEFAULT_USER_PERMISSIONS);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setRole(null);
    setPermissions(DEFAULT_USER_PERMISSIONS);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, role, permissions, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}