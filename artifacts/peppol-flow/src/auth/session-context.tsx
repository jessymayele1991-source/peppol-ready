import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetSessionQueryKey,
  useGetSession,
  useLogout,
  useSwitchOrganization,
  type Capability,
  type Session,
} from '@workspace/api-client-react';

type SessionContextValue = {
  session: Session | null;
  isLoading: boolean;
  /** True for every capability the active role grants; the server enforces the same matrix. */
  can: (capability: Capability) => boolean;
  signOut: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const sessionQueryKey = getGetSessionQueryKey();

  const { data, isLoading } = useGetSession({
    query: {
      queryKey: sessionQueryKey,
      // A 401 is the normal answer for a signed-out visitor, not a fault.
      retry: false,
      staleTime: 60_000,
    },
  });

  const logout = useLogout();
  const switchOrganization = useSwitchOrganization();

  const value = useMemo<SessionContextValue>(() => {
    const session = data ?? null;
    const capabilities = new Set(session?.capabilities ?? []);

    return {
      session,
      isLoading,
      can: (capability) => capabilities.has(capability),
      signOut: async () => {
        await logout.mutateAsync();
        // Every cached response belongs to the session that just ended.
        queryClient.clear();
      },
      switchOrganization: async (organizationId) => {
        const next = await switchOrganization.mutateAsync({
          data: { organizationId },
        });
        queryClient.setQueryData(sessionQueryKey, next);
        // Tenant-scoped responses are no longer valid for the new workspace.
        await queryClient.invalidateQueries();
      },
    };
  }, [data, isLoading, logout, queryClient, sessionQueryKey, switchOrganization]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession requires SessionProvider');
  return context;
}
