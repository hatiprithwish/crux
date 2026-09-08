import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth, UserButton } from "@clerk/tanstack-react-start";
import { useQuery } from "@tanstack/react-query";
import type * as Schemas from "@app/schemas";
import { UsersQueries } from "@/providers/UsersQueries";
import { TrackersQueries } from "@/routes/_authenticated/trackers/-data";
import { formatMinorAmount } from "@/routes/_authenticated/trackers/-utils";
import { cn } from "@/utils/tailwind";

// DEV_NOTE: replaces the old top AppNav — design/today-web.png's whole premise is "the margin
// becomes the sidebar", so the shell and the Today screen shipped as one change (redesign-backlog.md
// notes what didn't). Renders the same nav data twice (a vertical list here, a bottom tab bar for
// small screens) rather than one component two ways, since the two layouts share no markup once the
// tracker list and footer are in the mix.
const PRIMARY_NAV = [
  { to: "/trackers", label: "Today" },
  { to: "/metrics", label: "Patterns" },
  { to: "/entities", label: "Things" },
] as const;

function useDayNumber(): number | null {
  const { getToken } = useAuth();
  const { data } = useQuery(UsersQueries.me(getToken));
  // DEV_NOTE: lazy init, not `new Date()` inline — render must stay pure. "Today" only changes once
  // a day, so there's no need for this to tick like -TrackerTimeline.tsx's clock does.
  const [now] = useState(() => new Date());
  const createdAt = data?.user?.createdAt;
  if (!createdAt) return null;

  const created = new Date(createdAt);
  const startOfCreated = Date.UTC(
    created.getUTCFullYear(),
    created.getUTCMonth(),
    created.getUTCDate(),
  );
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return Math.round((startOfToday - startOfCreated) / (1000 * 60 * 60 * 24)) + 1;
}

// DEV_NOTE: the one non-toggle, non-money value worth showing at a glance in the rail — everything
// else (increment/stepper/daily_total/form) just prints todaySum, which is exactly what those
// controls already show inline (-IncrementControl.tsx etc).
function trackerRailValue(row: Schemas.TrackerTodayApiShape): string {
  const { tracker, todaySum, openSession } = row;

  if (tracker.manifest.control === "timer") return openSession ? "" : "—";
  if (tracker.manifest.control === "toggle") return todaySum !== null ? "✓" : "—";
  if (tracker.manifest.control === "amount_pad") {
    return todaySum !== null ? formatMinorAmount(todaySum) : "—";
  }
  return todaySum !== null ? String(todaySum) : "—";
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {PRIMARY_NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          activeOptions={{ exact: false }}
          className="border-l-2 border-transparent py-1.5 pl-3 text-sm font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground data-[status=active]:border-primary data-[status=active]:text-foreground data-[status=active]:font-semibold"
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

export function AppSidebar() {
  const { getToken } = useAuth();
  const dayNumber = useDayNumber();
  const { data } = useQuery(TrackersQueries.list(true, getToken));
  const today = data?.today ?? [];

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="px-5 pt-6 pb-4">
        <p className="font-heading text-xl font-bold text-sidebar-foreground">Crux</p>
        {dayNumber !== null && (
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Day {dayNumber}
          </p>
        )}
      </div>

      <nav className="flex flex-col gap-1 px-5">
        <NavLinks />
      </nav>

      <div className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto px-5">
        <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Trackers
        </p>
        {today.map((row) => (
          <Link
            key={row.tracker.publicId}
            to="/trackers/$trackerId"
            params={{ trackerId: row.tracker.publicId }}
            className="flex items-center justify-between gap-2 rounded-md py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <span className="truncate">{row.tracker.name}</span>
            <span
              className={cn(
                "shrink-0 text-xs tabular-nums text-muted-foreground",
                row.tracker.manifest.control === "timer" && row.openSession && "text-primary",
              )}
            >
              {row.tracker.manifest.control === "timer" && row.openSession ? (
                <span className="inline-block size-2 rounded-full bg-primary" />
              ) : (
                trackerRailValue(row)
              )}
            </span>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-sidebar-border px-5 py-4">
        <Link
          to="/archived"
          className="text-xs text-muted-foreground hover:text-foreground"
          activeProps={{ className: "text-foreground" }}
        >
          Archived
        </Link>
        <div className="flex items-center gap-2">
          <UserButton />
        </div>
      </div>
    </aside>
  );
}

export function AppBottomNav() {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-sidebar-border bg-sidebar md:hidden">
      {PRIMARY_NAV.map((item) => {
        const isActive =
          item.to === "/trackers" ? pathname.startsWith("/trackers") : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex-1 py-3 text-center text-xs font-medium tracking-wide uppercase",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
