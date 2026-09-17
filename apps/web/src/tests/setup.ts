import "@testing-library/jest-dom";
import { vi } from "vitest";

// DEV_NOTE: jsdom has no matchMedia implementation — any component reading a media query (e.g.
// -MomentCapture.tsx's mobile/desktop Sheet side) throws without this. Defaults to "no match" (a
// desktop-width test), which every test overrides via mockReturnValue when it cares.
window.matchMedia ??= vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));
