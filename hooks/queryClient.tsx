"use client";

import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

// app/suivi-rl/page.tsx originally persisted its rows to localStorage itself
// (loadCachedRows/saveCachedRows) so a repeat visit painted instantly from
// the last-known cache before the background refresh landed. Plain
// TanStack Query's cache is in-memory only and wouldn't survive a hard
// reload the same way, so this persists the query cache to localStorage —
// scoped to only the "bdd" query key via shouldDehydrateQuery, so Parking/
// Atelier/other pages (which never had this behavior) aren't affected.
const BDD_QUERY_KEY = "bdd";

export function AppQueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
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
          shouldDehydrateQuery: (query) => query.queryKey[0] === BDD_QUERY_KEY,
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
