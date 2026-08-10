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
// scoped via shouldDehydrateQuery to only the query keys below.
const BDD_QUERY_KEY = "bdd";

// Parking/Atelier/Depot's shared plate list (["parking","imm-list"]) and DS
// History's widened plate-suggestion list (["parking","vehicle-suggestions"])
// both back a server-side week-long Mongo cache (see getIMMList()/
// getVehicleSuggestionList() in lib/googleSheetsParking.ts) — persisting them
// client-side too means a repeat page load paints suggestions instantly with
// zero network round trip, only revalidating in the background once stale.
function isPersistedPlateListKey(key: readonly unknown[]): boolean {
  return key[0] === "parking" && (key[1] === "imm-list" || key[1] === "vehicle-suggestions");
}

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
          shouldDehydrateQuery: (query) =>
            query.queryKey[0] === BDD_QUERY_KEY || isPersistedPlateListKey(query.queryKey),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
