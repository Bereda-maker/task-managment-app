import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { setAccessToken, setErrorReporter, setSessionExpiredHandler } from "../lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAccessToken(null);
});

// Keep module-level hooks from leaking between test files.
afterEach(() => {
  setErrorReporter(() => {})();
  setSessionExpiredHandler(() => {})();
});
