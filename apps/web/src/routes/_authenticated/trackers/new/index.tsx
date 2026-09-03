import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCreateTracker } from "../-data";
import { TrackerForm } from "../-TrackerForm";

export const Route = createFileRoute("/_authenticated/trackers/new/")({
  component: NewTrackerPage,
});

function NewTrackerPage() {
  const navigate = useNavigate();
  const createTracker = useCreateTracker();

  return (
    <div className="mx-auto max-w-2xl p-6 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New tracker</h1>
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
