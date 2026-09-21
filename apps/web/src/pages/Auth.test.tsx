import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { apiError, mockApi, renderApp, respond, session } from "../test/utils";

describe("session restore", () => {
  it("sends anonymous visitors to the login page — without an error toast for the expected 401", async () => {
    mockApi({ "POST /auth/refresh": () => apiError(401, "NO_SESSION", "No active session") });
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("restores a session from the refresh cookie on load (stay logged in across restarts)", async () => {
    const { callsTo } = mockApi({
      "POST /auth/refresh": () => respond(session),
      "GET /boards": () => respond({ boards: [{ id: "b1", name: "Launch plan", ownerId: session.user.id, createdAt: "", role: "owner", memberCount: 2 }] }),
    });
    renderApp("/");

    expect(await screen.findByRole("link", { name: /Launch plan/ })).toBeInTheDocument();
    expect(callsTo("POST /auth/refresh")).toHaveLength(1);
    expect(callsTo("GET /boards")[0]!.auth).toBe("Bearer token-1");
    expect(screen.getByText(session.user.name)).toBeInTheDocument();
  });
});

describe("login form", () => {
  it("shows validation errors instantly and never calls the API while invalid", async () => {
    const user = userEvent.setup();
    const { callsTo } = mockApi({ "POST /auth/refresh": () => apiError(401, "NO_SESSION", "No active session") });
    renderApp("/login");
    await screen.findByRole("heading", { name: "Log in" });

    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(callsTo("POST /auth/login")).toHaveLength(0);
  });

  it("logs in and lands on the boards page", async () => {
    const user = userEvent.setup();
    const { callsTo } = mockApi({
      "POST /auth/refresh": () => apiError(401, "NO_SESSION", "No active session"),
      "POST /auth/login": () => respond(session),
      "GET /boards": () => respond({ boards: [] }),
    });
    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), "  Alice@Example.com ");
    await user.type(screen.getByLabelText("Password"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Your boards" })).toBeInTheDocument();
    expect(callsTo("POST /auth/login")[0]!.body).toEqual({ email: "alice@example.com", password: "correct-horse-battery" });
  });

  it("toasts the server's message when credentials are wrong and stays on the form", async () => {
    const user = userEvent.setup();
    mockApi({
      "POST /auth/refresh": () => apiError(401, "NO_SESSION", "No active session"),
      "POST /auth/login": () => apiError(401, "INVALID_CREDENTIALS", "Invalid email or password"),
    });
    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });
});

describe("register form", () => {
  it("enforces the password rule client-side, then registers", async () => {
    const user = userEvent.setup();
    const { callsTo } = mockApi({
      "POST /auth/refresh": () => apiError(401, "NO_SESSION", "No active session"),
      "POST /auth/register": () => respond(session, 201),
      "GET /boards": () => respond({ boards: [] }),
    });
    renderApp("/register");

    await user.type(await screen.findByLabelText("Name"), "Alice Adams");
    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Password must be at least 8 characters")).toBeInTheDocument();
    expect(callsTo("POST /auth/register")).toHaveLength(0);

    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "long-enough-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(callsTo("POST /auth/register")).toHaveLength(1));
    expect(await screen.findByRole("heading", { name: "Your boards" })).toBeInTheDocument();
  });
});

describe("signing out", () => {
  it("calls /auth/logout and returns to the login page", async () => {
    const user = userEvent.setup();
    const { callsTo } = mockApi({
      "POST /auth/refresh": () => respond(session),
      "GET /boards": () => respond({ boards: [] }),
      "POST /auth/logout": () => respond(null, 204),
    });
    renderApp("/");

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
    expect(callsTo("POST /auth/logout")).toHaveLength(1);
  });
});
