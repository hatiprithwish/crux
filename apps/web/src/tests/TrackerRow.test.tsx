import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import TrackerRow from "@/routes/_authenticated/trackers/-TrackerRow";
import type * as Schemas from "@app/schemas";

// Mock tanstack-router Link — renders plain anchor in jsdom
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

const mockQuickAdd = vi.fn();
vi.mock("@/routes/_authenticated/trackers/-data", () => ({
  useQuickAdd: () => ({ mutate: mockQuickAdd, isPending: false }),
  useArchiveTracker: () => ({ mutate: vi.fn(), isPending: false }),
}));

// DEV_NOTE: EntityLinkFields owns five entity queries of its own — the controls that embed it
// (amount_pad, form) are exercised here for their dispatch, not their entity picker, so it's
// stubbed the same lightweight way NoteCard's test stubs its data layer.
vi.mock("@/routes/_authenticated/trackers/-EntityLinkFields", () => ({
  EntityLinkFields: () => null,
}));

function makeTracker(
  control: Schemas.Control,
  manifest: Partial<Schemas.TrackerManifest> = {},
): Schemas.TrackerApiShape {
  return {
    publicId: "trk_test123",
    userId: "user_test123",
    name: "Test Tracker",
    emoji: null,
    colorIndex: null,
    manifest: {
      control,
      metrics: ["test_metric"],
      target: null,
      step: null,
      entryMode: "retro",
      schedule: { type: "daily" },
      compute: null,
      ...manifest,
    },
    manifestVersion: 1,
    sortOrder: 0,
    activeFrom: "2026-01-01",
    activeTo: null,
    primaryMetricPublicId: "met_test123",
    primaryMetricKey: "test_metric",
    metricDetails: [
      {
        metricPublicId: "met_test123",
        key: "test_metric",
        name: "Test Metric",
        semanticType: "count",
        canonicalUnit: "count",
      },
    ],
    createdAt: new Date(),
    updatedAt: null,
    archivedAt: null,
  };
}

function makeToday(
  tracker: Schemas.TrackerApiShape,
  overrides: Partial<Schemas.TrackerTodayApiShape> = {},
): Schemas.TrackerTodayApiShape {
  return {
    tracker,
    todaySum: null,
    todayCount: 0,
    streak: 0,
    openSession: null,
    ...overrides,
  };
}

describe("TrackerRow", () => {
  it("renders the tracker name and schedule", () => {
    render(<TrackerRow today={makeToday(makeTracker("toggle"))} />);
    expect(screen.getByText("Test Tracker")).toBeInTheDocument();
    expect(screen.getByText(/every day/i)).toBeInTheDocument();
  });

  it("shows the streak once there is one", () => {
    render(<TrackerRow today={makeToday(makeTracker("toggle"), { streak: 4 })} />);
    expect(screen.getByText(/4 day streak/i)).toBeInTheDocument();
  });

  // DEV_NOTE: the dispatch itself is the thing worth testing — manifest.control is the only reason
  // any of these widgets appear, and getting it wrong is what a per-domain frontend used to prevent.
  it("renders the toggle control for a toggle manifest", () => {
    render(<TrackerRow today={makeToday(makeTracker("toggle"))} />);
    expect(screen.getByRole("button", { name: /mark done/i })).toBeInTheDocument();
  });

  it("shows 'Done today' when the day is already logged", () => {
    render(<TrackerRow today={makeToday(makeTracker("toggle"), { todaySum: 1, todayCount: 1 })} />);
    expect(screen.getByRole("button", { name: /done today/i })).toBeInTheDocument();
  });

  it("renders the stepper control with its step size", () => {
    render(<TrackerRow today={makeToday(makeTracker("stepper", { step: 2 }))} />);
    expect(screen.getByRole("button", { name: /add 2 to test tracker/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /subtract 2 from test tracker/i }),
    ).toBeInTheDocument();
  });

  it("renders the timer's start control when nothing is running", () => {
    render(<TrackerRow today={makeToday(makeTracker("timer"))} />);
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
  });

  it("renders the timer's stop control for a running session", () => {
    const openSession: Schemas.TrackerEntryApiShape = {
      publicId: "eny_running",
      entryKind: "interval",
      occurredAt: new Date(),
      endedAt: null,
      durationSeconds: null,
      localDate: "2026-01-01",
      label: "Deep work",
      note: null,
      transferGroupId: null,
      values: [],
      entities: [],
      createdAt: new Date(),
    };

    render(<TrackerRow today={makeToday(makeTracker("timer"), { openSession })} />);
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    expect(screen.getByText(/deep work/i)).toBeInTheDocument();
  });

  it("renders the archive button", () => {
    render(<TrackerRow today={makeToday(makeTracker("toggle"))} />);
    expect(screen.getByRole("button", { name: /archive/i })).toBeInTheDocument();
  });
});
