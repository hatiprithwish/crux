import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import NoteCard from "@/routes/_authenticated/notes/-NoteCard";
import { NoteStatusIntEnum, NoteStatusLabelEnum } from "@app/schemas";
import type * as Schemas from "@app/schemas";

// Mock tanstack-router Link — renders plain anchor in jsdom
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// Mock react-query mutation used by NoteCard
vi.mock("@/routes/_authenticated/notes/-data", () => ({
  useDeleteNote: () => ({ mutate: vi.fn(), isPending: false }),
}));

const mockNote: Schemas.NoteWithStatus = {
  publicId: "abc123publicid",
  userId: "user_test123",
  title: "Test Note",
  body: "This is the note body.",
  status: NoteStatusIntEnum.Draft,
  noteStatus: NoteStatusIntEnum.Draft,
  noteStatusLabel: NoteStatusLabelEnum.Draft,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("NoteCard", () => {
  it("renders title", () => {
    render(<NoteCard note={mockNote} />);
    expect(screen.getByText("Test Note")).toBeInTheDocument();
  });

  it("renders body when present", () => {
    render(<NoteCard note={mockNote} />);
    expect(screen.getByText("This is the note body.")).toBeInTheDocument();
  });

  it("renders delete button", () => {
    render(<NoteCard note={mockNote} />);
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("omits body section when body is null", () => {
    render(<NoteCard note={{ ...mockNote, body: null }} />);
    expect(screen.queryByText("This is the note body.")).not.toBeInTheDocument();
  });
});
