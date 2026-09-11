import { useAuth } from "@clerk/tanstack-react-start";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shadcn/ui/card";
import { Switch } from "@/shadcn/ui/switch";
import { Input } from "@/shadcn/ui/input";
import { Label } from "@/shadcn/ui/label";
import { NotificationsQueries, useUpdateNotificationPrefs } from "./-data";

export function TriggerPrefsCard() {
  const { getToken } = useAuth();
  const prefsQuery = useQuery(NotificationsQueries.prefs(getToken));
  const updatePrefs = useUpdateNotificationPrefs();

  const prefs = prefsQuery.data?.prefs;

  if (prefsQuery.isPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reminder preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (prefsQuery.isError || !prefs) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reminder preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Failed to load preferences.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reminder preferences</CardTitle>
        <CardDescription>Which of these can send you a notification.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Daily tracker reminders</span>
            <span className="text-xs text-muted-foreground">
              A nudge at each tracker's chosen hour if it's still unlogged.
            </span>
          </div>
          <Switch
            checked={prefs.trackerRemindersEnabled}
            disabled={updatePrefs.isPending}
            onCheckedChange={(checked) => updatePrefs.mutate({ trackerRemindersEnabled: checked })}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Evening digest</span>
            <span className="text-xs text-muted-foreground">
              One summary of what's still open today.
            </span>
          </div>
          <div className="flex items-center gap-2">
            {prefs.streakDigestEnabled ? (
              <>
                <Label htmlFor="streak-digest-hour" className="text-xs text-muted-foreground">
                  at
                </Label>
                <Input
                  id="streak-digest-hour"
                  type="number"
                  min={0}
                  max={23}
                  value={prefs.streakDigestHour}
                  disabled={updatePrefs.isPending}
                  onChange={(event) => {
                    const hour = Number(event.target.value);
                    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
                      updatePrefs.mutate({ streakDigestHour: hour });
                    }
                  }}
                  className="w-16"
                />
              </>
            ) : null}
            <Switch
              checked={prefs.streakDigestEnabled}
              disabled={updatePrefs.isPending}
              onCheckedChange={(checked) => updatePrefs.mutate({ streakDigestEnabled: checked })}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Open timer nag</span>
            <span className="text-xs text-muted-foreground">
              A repeat nudge every N minutes an interval tracker is left running.
            </span>
          </div>
          <div className="flex items-center gap-2">
            {prefs.openIntervalEnabled ? (
              <>
                <Input
                  aria-label="Minutes between open-timer nags"
                  type="number"
                  min={1}
                  value={prefs.openIntervalThresholdMinutes}
                  disabled={updatePrefs.isPending}
                  onChange={(event) => {
                    const minutes = Number(event.target.value);
                    if (Number.isInteger(minutes) && minutes > 0) {
                      updatePrefs.mutate({ openIntervalThresholdMinutes: minutes });
                    }
                  }}
                  className="w-20"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </>
            ) : null}
            <Switch
              checked={prefs.openIntervalEnabled}
              disabled={updatePrefs.isPending}
              onCheckedChange={(checked) => updatePrefs.mutate({ openIntervalEnabled: checked })}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
