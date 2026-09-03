import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCreateEntity } from "../-data";
import { EntityForm } from "../-EntityForm";

export const Route = createFileRoute("/_authenticated/entities/new/")({
  component: NewEntityPage,
});

function NewEntityPage() {
  const navigate = useNavigate();
  const createEntity = useCreateEntity();

  return (
    <div className="mx-auto max-w-2xl p-6 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New entity</h1>
      <EntityForm
        submitLabel="Create entity"
        onSubmit={async (value) => {
          await createEntity.mutateAsync({ entity: value });
          navigate({ to: "/entities" });
        }}
        onCancel={() => navigate({ to: "/entities" })}
      />
    </div>
  );
}
