import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CaretRight } from "@phosphor-icons/react";
import { useCreateTracker } from "../-data";
import { TrackerForm } from "../-TrackerForm";

// DEV_NOTE: full-bleed rather than the max-w-2xl every other screen uses — this one carries a live
// preview column beside the fields, and the preview is only worth its width if both halves are
// visible at once. The breadcrumb is route-local: the app's chrome is still AppSidebar.
export const Route = createFileRoute("/_authenticated/trackers/new/")({
  component: NewTrackerPage,
});

function NewTrackerPage() {
  const navigate = useNavigate();
  const createTracker = useCreateTracker();

  return (
    <div className="flex min-h-screen flex-col">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-2 border-b border-border px-6 py-4 text-xs tracking-widest uppercase"
      >
        <Link
          to="/trackers"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Today
        </Link>
        <CaretRight className="size-3 text-muted-foreground" />
        <span className="font-medium">New tracker</span>
      </nav>

      <TrackerForm
        submitLabel="Create tracker"
        onSubmit={async (value) => {
          await createTracker.mutateAsync(value);
          navigate({ to: "/trackers" });
        }}
        onCancel={() => navigate({ to: "/trackers" })}
      />
    </div>
  );
}
