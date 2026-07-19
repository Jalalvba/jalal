"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function AppQueryProvider({ children }: { children: React.ReactNode }) {
  // One QueryClient per browser session (useState lazy init, not module
  // scope) — module scope would leak/share state across requests on the
  // server; this only ever runs client-side anyway ("use client"), but
  // keeping the instance owned by the component tree is the safe default.
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
