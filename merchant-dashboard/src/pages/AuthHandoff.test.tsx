import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, setSession } = vi.hoisted(() => ({ invoke: vi.fn(), setSession: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  supabase: { functions: { invoke }, auth: { setSession } },
}));

import { AuthHandoff } from "./AuthHandoff";

const SESSION = { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" };

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/auth/handoff" element={<AuthHandoff />} />
        <Route path="/" element={<p>dashboard home</p>} />
        <Route path="/orders" element={<p>orders page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  setSession.mockReset();
  setSession.mockResolvedValue({ error: null });
});

describe("merchant-dashboard AuthHandoff", () => {
  it("exchanges the code with tolo-merchant-login, stores the session, and lands on the dashboard", async () => {
    invoke.mockResolvedValue({ data: { session: SESSION }, error: null });
    renderAt("/auth/handoff?code=one-time&embed=app");

    expect(await screen.findByText("dashboard home")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("tolo-merchant-login", { body: { code: "one-time" } });
    expect(setSession).toHaveBeenCalledWith({ access_token: "at", refresh_token: "rt" });
  });

  it("honours an in-app next path", async () => {
    invoke.mockResolvedValue({ data: { session: SESSION }, error: null });
    renderAt("/auth/handoff?code=c&next=/orders");
    expect(await screen.findByText("orders page")).toBeInTheDocument();
  });

  it("ignores an off-site next and lands on the dashboard instead", async () => {
    invoke.mockResolvedValue({ data: { session: SESSION }, error: null });
    renderAt("/auth/handoff?code=c&next=//evil.example");
    expect(await screen.findByText("dashboard home")).toBeInTheDocument();
  });

  it("shows a failure and stores no session when the exchange is refused", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("401") });
    renderAt("/auth/handoff?code=bad");
    expect(await screen.findByText(/Merchant sign-in failed/)).toBeInTheDocument();
    expect(setSession).not.toHaveBeenCalled();
  });

  it("does nothing without a code", async () => {
    renderAt("/auth/handoff");
    expect(await screen.findByText("Missing sign-in code.")).toBeInTheDocument();
    await waitFor(() => expect(invoke).not.toHaveBeenCalled());
  });
});
