import { createFileRoute, redirect } from "@tanstack/react-router";

// DEV_NOTE: the app has no home of its own — Today is the home. Redirecting here rather than
// rendering a placeholder means "/" is never a dead end, and the _authenticated layout still handles
// the signed-out case (it renders the sign-in prompt itself).
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/trackers" });
  },
});
