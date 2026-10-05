import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@tolo/ui";
import { CustomerDetail, type CustomerDetailData } from "./CustomerDetail";
import { MerchantDetail, type MerchantDetailData } from "./MerchantDetail";

// What the database is told is covered by the SQL tests (supabase/tests/admin_detail_controls.test.ts). This file is
// about the screen: staff must not even be shown the buttons only admin tier may use.
const auth = vi.hoisted(() => ({ isAdmin: false }));
const rpc = vi.hoisted(() => vi.fn());

vi.mock("../lib/AuthContext", () => ({ useAuth: () => ({ isAdmin: auth.isAdmin }) }));
vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => rpc(name, args),
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: [{ id: "c1", name: "Electronics" }] }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
    storage: { from: () => ({ remove: async () => ({}) }) },
  },
}));

const customer: CustomerDetailData = {
  profile: { id: "u1", full_name: "Abebe Kebede", phone: "+251911000111", account_status: "active", suspension_reason: null, created_at: "2026-09-01T00:00:00Z", anonymized_at: null, referral_code: null },
  email: "abebe@mail.test",
  last_sign_in_at: null,
  tolo_linked: true,
  tolo_phone: "••••0111",
  addresses: [{ id: "a1", label: "Home", recipient_name: "Abebe", phone: "+251911000111", line1: "Bole 1", line2: null, city: "Addis Ababa", region: null, landmark: null, sub_city: null }],
  orders: [{ id: "o1", order_number: 1001, total: 500, payment_status: "paid", created_at: "2026-09-02T00:00:00Z", statuses: ["completed"] }],
  order_count: 1,
  paid_total: 500,
  refunds: [],
  reviews: [],
  cart_items: 0,
  favorites: 0,
  audit: [],
};

const merchant = (overrides: Partial<MerchantDetailData> = {}, status = "active"): MerchantDetailData => ({
  merchant: {
    id: "m1", business_name: "Habesha Shop", category_id: "c1", status, source: "dashboard", location: null, city: "Addis Ababa", sub_city: null,
    woreda: null, landmark: null, latitude: null, longitude: null, created_at: "2026-09-01T00:00:00Z", approved_at: null, rejection_reason: null,
    suspension_reason: null, closed_at: null, close_reason: null,
  },
  private: { phone: "+251911222333", email: "shop@mail.test", owner_full_name: "Owner", owner_phone: null, owner_email: null, business_registration_number: null },
  store: { name: "Habesha Store", description: null, operating_hours: {}, logo_url: null, banner_url: null, pickup_address: null, prep_time_minutes: null, status: "active" },
  owner: { id: "o1", full_name: "Owner" },
  tin: null,
  products: { total: 2, published: 1 },
  orders: { total: 0, by_status: {} },
  rating: { avg: null, count: 0 },
  commission_rules: [],
  wallet_balance: null,
  payouts: [],
  applications: [],
  documents: [],
  audit: [],
  can_hard_delete: true,
  active_orders: 0,
  ...overrides,
});

function renderWith(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  rpc.mockReset();
  auth.isAdmin = false;
});

describe("CustomerDetail", () => {
  beforeEach(() => rpc.mockResolvedValue({ data: customer, error: null }));

  it("shows staff the profile and edit controls but no delete button, and a locked phone field", async () => {
    renderWith(<CustomerDetail customerId="u1" />);
    expect(await screen.findByText("Abebe Kebede")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete customer" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.getByLabelText("Phone")).toBeDisabled();
    expect(screen.getByText(/Only an admin or super admin can change the phone number/)).toBeInTheDocument();
  });

  it("shows admin tier the delete button, an enabled phone field with a warning, and makes them type DELETE", async () => {
    auth.isAdmin = true;
    renderWith(<CustomerDetail customerId="u1" />);
    await screen.findByText("Abebe Kebede");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.getByLabelText("Phone")).toBeEnabled();
    expect(screen.getByText(/Changing a phone number changes who staff and drivers will call/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete customer" }));
    const confirm = screen.getAllByRole("button", { name: "Delete customer" }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    expect(confirm).toBeEnabled();
    rpc.mockResolvedValueOnce({ data: { addresses_overwritten: 1, addresses_deleted: 0 }, error: null });
    fireEvent.click(confirm);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_anonymize_customer", { p_customer_id: "u1" }));
  });

  it("sends only what changed, and never the phone for staff", async () => {
    renderWith(<CustomerDetail customerId="u1" />);
    await screen.findByText("Abebe Kebede");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Abebe K." } });
    rpc.mockResolvedValueOnce({ data: null, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_update_customer", { p_customer_id: "u1", p_changes: { full_name: "Abebe K." } }));
  });

  it("offers nothing to edit or delete on an already deleted customer", async () => {
    auth.isAdmin = true;
    rpc.mockResolvedValue({ data: { ...customer, profile: { ...customer.profile, anonymized_at: "2026-10-01T00:00:00Z", full_name: "Deleted customer" } }, error: null });
    renderWith(<CustomerDetail customerId="u1" />);
    expect(await screen.findByText(/This customer was deleted on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete customer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });
});

describe("MerchantDetail", () => {
  it("hides close, delete, the TIN and approve/reject from staff", async () => {
    rpc.mockResolvedValue({ data: merchant({}, "registered"), error: null });
    renderWith(<MerchantDetail merchantId="m1" />);
    expect(await screen.findByText("Habesha Shop")).toBeInTheDocument();
    for (const name of ["Close merchant", "Delete merchant", "Approve", "Reject", "Edit TIN"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText("Danger zone")).not.toBeInTheDocument();
  });

  it("locks the sensitive contact fields for staff while they edit the rest", async () => {
    rpc.mockResolvedValue({ data: merchant(), error: null });
    renderWith(<MerchantDetail merchantId="m1" />);
    await screen.findByText("Habesha Shop");
    fireEvent.click(screen.getByRole("button", { name: "Edit merchant" }));
    expect(screen.getByLabelText("Business phone")).toBeDisabled();
    expect(screen.getByLabelText("Owner phone")).toBeDisabled();
    expect(screen.getByLabelText("Registration number")).toBeDisabled();
    expect(screen.getByLabelText("Business email")).toBeEnabled();
    expect(screen.getByLabelText("Business name")).toBeEnabled();
  });

  it("shows admin tier the TIN, approve/reject, close and delete, and makes them type the merchant name", async () => {
    auth.isAdmin = true;
    rpc.mockResolvedValue({ data: merchant({ tin: "1234567890" }, "registered"), error: null });
    renderWith(<MerchantDetail merchantId="m1" />);
    await screen.findByText("Habesha Shop");
    expect(screen.getByText("1234567890")).toBeInTheDocument();
    expect(screen.getByText("Provided by applicant, verify manually")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete merchant" }));
    const confirm = screen.getAllByRole("button", { name: "Delete merchant" }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type the merchant name (Habesha Shop) to confirm"), { target: { value: "Habesha Shop" } });
    expect(confirm).toBeEnabled();
  });

  it("offers Close instead of Delete once the merchant has history, and Reopen to staff on a closed one", async () => {
    auth.isAdmin = true;
    rpc.mockResolvedValue({ data: merchant({ can_hard_delete: false }), error: null });
    const { unmount } = renderWith(<MerchantDetail merchantId="m1" />);
    await screen.findByText("Habesha Shop");
    expect(screen.queryByRole("button", { name: "Delete merchant" })).not.toBeInTheDocument();
    expect(screen.getByText(/has had orders or payouts, so it cannot be deleted/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close merchant" })).toBeInTheDocument();
    unmount();

    auth.isAdmin = false;
    rpc.mockResolvedValue({ data: merchant({}, "closed"), error: null });
    renderWith(<MerchantDetail merchantId="m1" />);
    await screen.findByText("Habesha Shop");
    expect(screen.getByRole("button", { name: "Reopen merchant" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close merchant" })).not.toBeInTheDocument();
  });
});
