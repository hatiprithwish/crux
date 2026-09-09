import { createRootRouteWithContext, Outlet, HeadContent, Scripts } from "@tanstack/react-router";
import { ClerkProvider } from "@clerk/tanstack-react-start";
import * as Sentry from "@sentry/tanstackstart-react";
import type { QueryClient } from "@tanstack/react-query";
import appCss from "../styles.css?url";
import type { ReactNode } from "react";
import { Toaster } from "../shadcn/ui/sonner";
import { TooltipProvider } from "../shadcn/ui/tooltip";
import { ThemeProvider } from "../providers/ThemeProvider";

interface RouterContext {
  queryClient: QueryClient;
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}

function RootErrorComponent({ error }: { error: unknown }) {
  Sentry.captureException(error);
  return (
    <div>
      <h1>Something went wrong</h1>
      <pre>{error instanceof Error ? error.message : String(error)}</pre>
    </div>
  );
}

function NotFoundComponent() {
  return <div>404 — page not found</div>;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Crux" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  // DEV_NOTE: TooltipProvider is mounted app-wide because Radix's Tooltip.Root *throws* without a
  // provider ancestor rather than degrading — @radix-ui/react-tooltip creates its provider context
  // with no default, so a `<Tooltip>` outside one takes the whole page down. Our shadcn tooltip.tsx
  // is the older shape that doesn't wrap Root in a provider of its own, so the app has to. Anything
  // rendering a tooltip (AppTable's column headers and pagination are the first) depends on this.
  component: () => (
    <RootDocument>
      <ThemeProvider defaultTheme="system" storageKey="app-theme">
        <TooltipProvider>
          <ClerkProvider
            publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
            signInUrl="/auth/sign-in"
            signUpUrl="/auth/sign-up"
            afterSignOutUrl="/auth/sign-in"
          >
            <Outlet />
          </ClerkProvider>
        </TooltipProvider>
      </ThemeProvider>
    </RootDocument>
  ),
  errorComponent: ({ error }) => <RootErrorComponent error={error} />,
  notFoundComponent: NotFoundComponent,
});
