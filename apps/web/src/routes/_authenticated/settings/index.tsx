import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/tanstack-react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shadcn/ui/card";
import { Label } from "@/shadcn/ui/label";
import { UsersQueries, useUpdateUser } from "@/providers/UsersQueries";
import { TimezonePicker } from "./-TimezonePicker";
import { PushEnableCard } from "./-PushEnableCard";
import { DeviceList } from "./-DeviceList";
import { TriggerPrefsCard } from "./-TriggerPrefsCard";

export const Route = createFileRoute("/_authenticated/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  const { getToken } = useAuth();
  const userQuery = useQuery(UsersQueries.me(getToken));
  const updateUser = useUpdateUser();

  return (
    <div className="mx-auto max-w-2xl p-6 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Timezone</CardTitle>
          <CardDescription>
            Decides when a reminder reaches you. It doesn't change which day your entries land on.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {userQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : userQuery.isError || !userQuery.data.user ? (
            <p className="text-sm text-destructive">Failed to load your settings.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <Label>Timezone</Label>
              <TimezonePicker
                value={userQuery.data.user.tz}
                disabled={updateUser.isPending}
                onChange={(tz) => updateUser.mutate({ tz })}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <PushEnableCard />
      <TriggerPrefsCard />
      <DeviceList />
    </div>
  );
}
