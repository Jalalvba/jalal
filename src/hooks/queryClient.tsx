"use client";

import { useState } from "react";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { toast } from "sonner";

// Every write action in the app goes through a useMutation call (see
// src/hooks/use*Rows.ts) — hooking success/error here once, via MutationCache,
// gives every one of them a toast without touching each call site. A
// mutation opts into a specific success message with
// `meta: { successMessage: "..." }`; without it, a generic fallback fires.
// Errors always surface the thrown Error's message (already the real
// server-side error text — see fetchJson() in each src/hooks/use*Rows.ts file).
const mutationCache = new MutationCache({
  onSuccess: (_data, _variables, _context, mutation) => {
    const message =
      typeof mutation.meta?.successMessage === "string" ? mutation.meta.successMessage : "Enregistré";
    toast.success(message);
  },
  onError: (error) => {
    toast.error(error instanceof Error ? error.message : "Une erreur est survenue");
  },
});

// src/app/suivi-rl/page.tsx originally persisted its rows to localStorage itself
// (loadCachedRows/saveCachedRows) so a repeat visit painted instantly from
// the last-known cache before the background refresh landed. Plain
// TanStack Query's cache is in-memory only and wouldn't survive a hard
// reload the same way, so this persists the query cache to localStorage —
// scoped via shouldDehydrateQuery to only the query keys below.
const BDD_QUERY_KEY = "bdd";

// The single shared full-plate-universe query (["vehicle-suggestions"], see
// src/hooks/useVehicleSuggestionList.ts) backs Parking/Atelier/Depot/DS
// History's plate inputs — persisting it client-side means only the very
// first page visited in a browser session ever fetches it; every other
// page/navigation reads localStorage with zero network round trip, only
// revalidating in the background once past its staleTime.
function isPersistedPlateListKey(key: readonly unknown[]): boolean {
  return key[0] === "vehicle-suggestions";
}

export function AppQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    mutationCache,
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  }));

  const [persister] = useState(() =>
    createAsyncStoragePersister({
      storage: typeof window === "undefined" ? undefined : window.localStorage,
      key: "jalal-query-cache",
    })
  );

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.queryKey[0] === BDD_QUERY_KEY || isPersistedPlateListKey(query.queryKey),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
