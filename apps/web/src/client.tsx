// DEV_NOTE: Tanstack Start Server entry point

import { StartClient } from "@tanstack/react-start/client";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { isPushSupported, registerServiceWorker } from "@/providers/pushClient";

// DEV_NOTE: registered on hydration, not lazily when the user reaches /settings — a Home Screen
// install needs the SW present before the user ever opens the app to that screen, and registration
// itself doesn't prompt for permission or subscribe (see -PushEnableCard.tsx for that flow).
if (isPushSupported()) {
  void registerServiceWorker();
}

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>,
);
