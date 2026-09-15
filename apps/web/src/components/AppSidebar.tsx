import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth, UserButton } from "@clerk/tanstack-react-start";
import { useQuery } from "@tanstack/react-query";
import { UsersQueries } from "@/providers/UsersQueries";
import { cn } from "@/utils/tailwind";

// DEV_NOTE: replaces the old top AppNav — design/today-web.png's whole premise is "the margin
// becomes the sidebar", so the shell and the Today screen shipped as one change (redesign-backlog.md
// notes what didn't). Renders the same nav data twice (a vertical list here, a bottom tab bar for
// small screens) rather than one component two ways, since the two layouts share no markup once the
// header and footer are in the mix.
//
// DEV_NOTE: the rail used to carry a per-tracker list with today's value beside each name. It was a
// second copy of the Today screen living one pane to its left — the same rows, the same numbers,
// kept in sync by a second `TrackersQueries.list` subscription. Navigation lost nothing when it
// went: TrackerRow already links each tracker to its detail page. What the sidebar is now is four
// destinations and a footer, which is all a shell owes the screens inside it.
//
// DEV_NOTE: `isActive` is a predicate per entry rather than a `Link` activeOptions flag because two
// of these destinations share a path prefix — /trackers is Today, /trackers/all is the management
// list, and prefix matching lights both. Today is therefore the one exact match in the list, while
// Trackers claims every other /trackers/* route: a tracker's detail and edit screens are places you
// arrive at from the management list, not places the day's log lives.
//
// DEV_NOTE: one predicate serves both navs. The bottom bar used to carry its own ternary special-
// casing /trackers, which is exactly the kind of drift that puts two navs on different answers.
interface NavItem {
  to: "/trackers" | "/trackers/all" | "/metrics" | "/entities";
  label: string;
  isActive: (pathname: string) => boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { to: "/trackers", label: "Today", isActive: (path) => path === "/trackers" },
  {
    to: "/trackers/all",
    label: "Trackers",
    isActive: (path) => path.startsWith("/trackers/"),
  },
  { to: "/metrics", label: "Metrics", isActive: (path) => path.startsWith("/metrics") },
  { to: "/entities", label: "Things", isActive: (path) => path.startsWith("/entities") },
];

// DEV_NOTE: exported so the Today screen's stat strip (-TodayStatStrip.tsx) can render the same
// "Day N" figure as "Tracking days" without a second implementation of this calc to drift from it.
export function useDayNumber(): number | null {
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

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <>
      {PRIMARY_NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={cn(
            "border-l-2 border-transparent py-1.5 pl-3 text-sm font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground",
            item.isActive(pathname) && "border-primary font-semibold text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}

export function AppSidebar() {
  const dayNumber = useDayNumber();

  return (
    // DEV_NOTE: sticky + h-screen, not the shell's full height. The page scrolls in document flow,
    // so a sidebar sized by the flex row grows with the tallest screen's content and takes its
    // footer — Archived and the user button — below the fold. Pinned to the viewport instead, the
    // footer is always reachable and the nav takes its own scrollbar if the list ever outgrows it.
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <div className="shrink-0 px-5 pt-6 pb-4">
        <p className="font-heading text-xl font-bold text-sidebar-foreground">Substrate</p>
        {dayNumber !== null && (
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Day {dayNumber}
          </p>
        )}
      </div>

      {/* flex-1 so the footer stays pinned to the bottom now that nothing grows between them.
          min-h-0 lets it shrink below its content height on a short viewport instead of pushing
          the footer out of the pinned column. */}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-5">
        <NavLinks />
      </nav>

      <div className="flex shrink-0 flex-col gap-2 border-t border-sidebar-border px-5 py-4">
        <div className="flex items-center gap-3">
          <Link
            to="/archived"
            className="text-xs text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground" }}
          >
            Archived
          </Link>
          <Link
            to="/settings"
            className="text-xs text-muted-foreground hover:text-foreground"
            activeProps={{ className: "text-foreground" }}
          >
            Settings
          </Link>
        </div>
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
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
      {PRIMARY_NAV.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className={cn(
            "flex-1 py-3 text-center text-xs font-medium tracking-wide uppercase",
            item.isActive(pathname) ? "text-primary" : "text-muted-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
