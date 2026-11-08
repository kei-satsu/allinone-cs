import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { supabase, supabaseConfigError } from '@/lib/supabase';

type Branch = 'MDY' | 'YGN';

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  isConfigured: boolean;
  configurationError: string | null;
  authError: string | null;
  role: string | null;
  branch: Branch;
  canSelectBranch: boolean;
  setBranch: (branch: Branch) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function getMetadataString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function branchForUser(user: User | null): { branch: Branch; canSelectBranch: boolean } {
  if (!user) return { branch: 'MDY', canSelectBranch: false };

  const role = getMetadataString(user.app_metadata?.role);
  const metadataBranch =
    getMetadataString(user.app_metadata?.branch) ??
    getMetadataString(user.user_metadata?.branch);
  const normalizedBranch = metadataBranch?.toUpperCase();
  const canSelectBranch = role === 'admin' || normalizedBranch === 'ADMIN';

  return {
    branch: normalizedBranch === 'YGN' ? 'YGN' : 'MDY',
    canSelectBranch,
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [authError, setAuthError] = useState<string | null>(null);
  const [adminBranch, setAdminBranch] = useState<Branch>('MDY');

  useEffect(() => {
    if (!supabase) return;

    let isMounted = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setAuthError(null);
      if (event === 'SIGNED_OUT') setAdminBranch('MDY');
      setIsLoading(false);
    });

    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setAuthError(error.message);
        } else {
          setSession(data.session);
        }
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setAuthError(error instanceof Error ? error.message : 'Session ကို စစ်ဆေးမရပါ။');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase ကို ပြင်ဆင်ထားခြင်းမရှိပါ။');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) throw new Error(supabaseConfigError ?? 'Supabase ကို ပြင်ဆင်ထားခြင်းမရှိပါ။');

    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const user = session?.user ?? null;
  const profile = useMemo(() => branchForUser(user), [user]);
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isConfigured: supabase !== null,
      configurationError: supabaseConfigError,
      authError,
      role: getMetadataString(user?.app_metadata?.role),
      branch: profile.canSelectBranch ? adminBranch : profile.branch,
      canSelectBranch: profile.canSelectBranch,
      setBranch: setAdminBranch,
      signIn,
      signOut,
    }),
    [adminBranch, authError, isLoading, profile, signIn, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
