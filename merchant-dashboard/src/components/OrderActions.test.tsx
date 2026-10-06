import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@tolo/ui";
import { OrderActions } from "./OrderActions";

const advance = vi.hoisted(() => vi.fn());
vi.mock("../lib/orderFlow", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/orderFlow")>()), advanceOrder: advance }));

// A fresh order id per test: the cooldown that stops a late second tap is kept per order, like in the real app.
let counter = 0;
let currentId = "";

function setup(status: string, onMoved = vi.fn()) {
  currentId = `o${++counter}`;
  render(
    <I18nProvider>
      <OrderActions orderId={currentId} status={status} onMoved={onMoved} />
    </I18nProvider>,
  );
  return onMoved;
}

beforeEach(() => advance.mockReset());

describe("OrderActions: the label follows the order's state", () => {
  it.each([
    ["new", "Accept & start preparing"],
    ["processing", "Ready for pickup"],
    ["ready_for_pickup", "Handed to driver"],
    ["accepted", "Start preparing"],
  ])("%s shows exactly one primary button, %s", (status, label) => {
    setup(status);
    expect(screen.getAllByTestId("primary-order-action")).toHaveLength(1);
    expect(screen.getByTestId("primary-order-action")).toHaveTextContent(label);
    expect(screen.getByTestId("reject-order-action")).toHaveTextContent("Reject / Cancel");
  });

  it("shows no buttons at all once the driver has the order or it is finished", () => {
    for (const status of ["picked_up", "delivered", "completed", "cancelled", "rejected"]) {
      const { container, unmount } = render(
        <I18nProvider>
          <OrderActions orderId={`done-${status}`} status={status} onMoved={() => {}} />
        </I18nProvider>,
      );
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe("OrderActions: moving the order", () => {
  it("sends one request straight to the next step and reports the new status", async () => {
    advance.mockResolvedValue({ ok: true, unchanged: false });
    const onMoved = setup("new");
    fireEvent.click(screen.getByTestId("primary-order-action"));
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith("processing"));
    expect(advance).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledWith(currentId, "processing", undefined);
  });

  it("ignores a second tap while the first is saving (double-tap guard), and disables the button", async () => {
    let finish!: (v: unknown) => void;
    advance.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onMoved = setup("new");
    const button = screen.getByTestId("primary-order-action");
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => finish({ ok: true, unchanged: false }));
    expect(onMoved).toHaveBeenCalledTimes(1);
  });

  it("holds the next button for a moment after a step, so a late second tap cannot skip a step", async () => {
    advance.mockResolvedValue({ ok: true, unchanged: false });
    const onMoved = setup("new");
    const button = screen.getByTestId("primary-order-action");
    fireEvent.click(button);
    await waitFor(() => expect(onMoved).toHaveBeenCalledTimes(1));
    fireEvent.click(button); // lands right after the response: the same button, now meant for the next step
    fireEvent.click(button);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });

  it("treats an order that is already there as success", async () => {
    advance.mockResolvedValue({ ok: true, unchanged: true });
    const onMoved = setup("processing");
    fireEvent.click(screen.getByTestId("primary-order-action"));
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith("ready_for_pickup"));
  });

  it("shows a clear error with Retry when it fails, keeps the button, and retrying works", async () => {
    advance.mockResolvedValueOnce({ ok: false, error: "" });
    const onMoved = setup("new");
    fireEvent.click(screen.getByTestId("primary-order-action"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't update the order");
    expect(onMoved).not.toHaveBeenCalled();
    expect(screen.getByTestId("primary-order-action")).toBeEnabled();

    advance.mockResolvedValueOnce({ ok: true, unchanged: false });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith("processing"));
    expect(advance).toHaveBeenCalledTimes(2);
  });
});

describe("OrderActions: reject / cancel", () => {
  it("asks for a reason, rejects a new order with it, and cancels one in progress", async () => {
    advance.mockResolvedValue({ ok: true, unchanged: false });
    const onMoved = setup("new");
    fireEvent.click(screen.getByTestId("reject-order-action"));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "out_of_stock" } });
    fireEvent.change(screen.getByLabelText("More detail (optional)"), { target: { value: "sold the last one" } });
    fireEvent.click(screen.getByTestId("confirm-reject"));
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith("rejected"));
    expect(advance).toHaveBeenCalledWith(currentId, "rejected", "Out of stock: sold the last one");
  });

  it("cancels (not rejects) an order that is being prepared", async () => {
    advance.mockResolvedValue({ ok: true, unchanged: false });
    const onMoved = setup("processing");
    fireEvent.click(screen.getByTestId("reject-order-action"));
    fireEvent.click(screen.getByTestId("confirm-reject"));
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith("cancelled"));
  });
});
