import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { Button } from "@/shadcn/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shadcn/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shadcn/ui/select";
import type * as Schemas from "@app/schemas";
import { EntitiesQueries, useArchiveEntity } from "./-data";

// DEV_NOTE: replaces Money's account/category lists and Time's project list — the named things any
// tracker's entries link to, in one place, because an entity is shared across trackers by design
// (architecture.md §5).
export const Route = createFileRoute("/_authenticated/entities/")({
  component: EntitiesPage,
});

const KIND_LABELS: Record<Schemas.EntityKind, string> = {
  project: "Projects",
  person: "People",
  place: "Places",
  goal: "Goals",
  account: "Accounts",
  tag: "Categories",
};

function EntitiesPage() {
  const { getToken } = useAuth();
  const [kind, setKind] = useState<Schemas.EntityKind>("account");
  const { data, isPending, isError } = useQuery(EntitiesQueries.list(kind, getToken));
  const archiveEntity = useArchiveEntity();

  const entities = (data?.entities ?? []).filter((entity) => !entity.archivedAt);

  return (
    <div className="mx-auto max-w-2xl p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Entities</h1>
        <Button asChild>
          <Link to="/entities/new">New entity</Link>
        </Button>
      </div>

      <Select value={kind} onValueChange={(value) => setKind(value as Schemas.EntityKind)}>
        <SelectTrigger className="w-56" aria-label="Entity kind">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {(Object.keys(KIND_LABELS) as Schemas.EntityKind[]).map((option) => (
              <SelectItem key={option} value={option}>
                {KIND_LABELS[option]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Card>
        <CardHeader>
          <CardTitle>{KIND_LABELS[kind]}</CardTitle>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : isError ? (
            <p className="text-sm text-destructive">Failed to load entities.</p>
          ) : entities.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {entities.map((entity) => (
                <div key={entity.publicId} className="flex items-center justify-between">
                  <Link
                    to="/entities/$entityId"
                    params={{ entityId: entity.publicId }}
                    className="hover:underline"
                  >
                    {entity.name}
                  </Link>
                  <div className="flex gap-2">
                    {/* DEV_NOTE: the entity rollup (architecture.md §6) is the least discoverable
                        screen in the app — it's the one place trackers stop mattering — so it gets
                        an explicit button rather than only a linked name. */}
                    <Button asChild variant="outline" size="sm">
                      <Link to="/entities/$entityId" params={{ entityId: entity.publicId }}>
                        Rollup
                      </Link>
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={archiveEntity.isPending}
                      onClick={() => archiveEntity.mutate(entity.publicId)}
                    >
                      Archive
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
