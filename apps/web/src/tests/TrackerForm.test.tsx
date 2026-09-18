import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrackerForm } from "@/routes/_authenticated/trackers/-TrackerForm";

vi.mock("@clerk/tanstack-react-start", () => ({
  useAuth: () => ({ getToken: async () => "token" }),
}));

function renderForm() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <TrackerForm onSubmit={vi.fn()} onCancel={vi.fn()} />
    </QueryClientProvider>,
  );
}

// DEV_NOTE: regression test for a crash where switching the schedule tile from "N per week" or
// "Every N days" straight to "Some days" threw `field.state.value.includes is not a function`.
// Both of those branches render a numeric form.Field (scheduleCount / scheduleIntervalDays) at the
// same JSX slot the array field (scheduleDays) renders at, and @tanstack/react-form's internal
// memoization can hand the new field a stale value from the branch it replaced for one render.
// Switching from "Every day" never hit this because that branch renders no form.Field at all.
describe("TrackerForm schedule tile switching", () => {
  it("does not crash going from N per week to Some days", () => {
    renderForm();
    fireEvent.click(screen.getByText("N per week"));
    fireEvent.click(screen.getByText("Some days"));
    expect(screen.getByText("Sun")).toBeInTheDocument();
  });

  it("does not crash going from Every N days to Some days", () => {
    renderForm();
    fireEvent.click(screen.getByText("Every N days"));
    fireEvent.click(screen.getByText("Some days"));
    expect(screen.getByText("Sun")).toBeInTheDocument();
  });

  it("does not crash going from Every day to Some days", () => {
    renderForm();
    fireEvent.click(screen.getByText("Some days"));
    expect(screen.getByText("Sun")).toBeInTheDocument();
  });
});
