import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PlatformProvider } from "@/platform/platform";
import { AuthProvider } from "@/auth/AuthProvider";
import { App } from "./App";
import "@/design/tokens.css";
import "@/design/base.css";
import "@/design/components.css";
import "@/design/layout.css";

// Running inside the Argent desktop app (Electron): the CSS leaves room for the
// native window buttons and makes the top bar draggable.
if (navigator.userAgent.includes("Electron/")) document.documentElement.dataset.shell = "desktop-app";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 15 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <PlatformProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </PlatformProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
