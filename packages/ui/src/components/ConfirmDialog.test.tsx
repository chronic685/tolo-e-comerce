import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18nProvider";
import { ConfirmDialog } from "./ConfirmDialog";

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <I18nProvider>
      <ConfirmDialog open title="Delete it?" message="This cannot be undone." confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} {...props} />
    </I18nProvider>,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("renders nothing while closed", () => {
    setup({ open: false });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the title and message, and puts focus on Cancel", () => {
    setup();
    expect(screen.getByRole("alertdialog", { name: "Delete it?" })).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("confirms only on the confirm button", () => {
    const { onConfirm, onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on the Cancel button and on Escape", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("locks both buttons and shows the busy label while the action runs", () => {
    const { onCancel } = setup({ busy: true, busyLabel: "Deleting..." });
    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
