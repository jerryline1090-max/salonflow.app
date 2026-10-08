import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { getSessionSnapshot, subscribeSession } from "./auth/sessionCache";
import { App } from "./App";
import "./styles/index.css";

function SessionBoundary() {
  const session = useSyncExternalStore(subscribeSession, getSessionSnapshot);
  return <QueryClientProvider key={session.revision} client={session.queryClient}><App /></QueryClientProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SessionBoundary />
  </StrictMode>
);
