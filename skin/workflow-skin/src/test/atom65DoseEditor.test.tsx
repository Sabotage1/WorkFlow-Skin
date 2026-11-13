import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Atom65DoseEditor, type Atom65ProfileSettings } from "../components/Atom65DoseEditor";

const profile = { title: "Espresso", steps: [{ pressure: 9 }] };
const devices = [{ id: "plugin:atom65.reaplugin:atom65:AA:BB", name: "Atom65" }];
const snapshot = (weight?: number): Atom65ProfileSettings => ({
  deviceId: devices[0].id, loaded: true, storageError: null, syncEnabled: true, maximumDose: 40,
  grinder: { minimum: 5, maximum: 1000 }, profile: { key: "recipe-hash", title: profile.title },
  rule: weight === undefined ? { mode: "leave" } : { mode: "fixed", weight }
});

describe("Atom65 profile dose editor", () => {
  it("reads the driver's default and saves only an explicit valid choice for this recipe and device", async () => {
    const callPluginEndpoint = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot(20.5));
    render(<Atom65DoseEditor profile={profile} integration={{ api: { callPluginEndpoint }, devices, supported: true }} />);
    const mode = screen.getByRole("combobox", { name: "When I choose this profile" });
    await waitFor(() => expect(mode).toBeEnabled());
    expect(mode).toHaveValue("leave");
    expect(callPluginEndpoint).toHaveBeenCalledTimes(1);
    await userEvent.selectOptions(mode, "fixed");
    const weight = screen.getByRole("spinbutton", { name: "Grind weight (g)" });
    const save = screen.getByRole("button", { name: "Save grinder choice" });
    expect(save).toBeDisabled();
    for (const invalid of ["4", "41", "18.05"]) { fireEvent.change(weight, { target: { value: invalid } }); expect(save).toBeDisabled(); }
    fireEvent.change(weight, { target: { value: "20.5" } });
    await userEvent.click(save);
    await screen.findByText("Grinder choice saved.");
    expect(callPluginEndpoint).toHaveBeenLastCalledWith("atom65.reaplugin", "profile-settings", {
      profile, choice: { profileKey: "recipe-hash", mode: "fixed", weight: 20.5 }
    }, "POST", { deviceId: devices[0].id });
  });

  it("does not claim a failed save succeeded and requires reloading the authoritative choice", async () => {
    const callPluginEndpoint = vi.fn().mockResolvedValueOnce(snapshot(19)).mockRejectedValueOnce(new Error("HTTP 502"));
    render(<Atom65DoseEditor profile={profile} integration={{ api: { callPluginEndpoint }, devices, supported: true }} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save grinder choice" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Save grinder choice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not confirm");
    expect(screen.queryByText("Grinder choice saved.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save grinder choice" })).toBeDisabled();
    expect(screen.queryByText(/HTTP 502/)).not.toBeInTheDocument();
  });

  it("ignores a late response after switching grinders", async () => {
    let resolveFirst!: (value: Atom65ProfileSettings) => void;
    const callPluginEndpoint = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; })).mockResolvedValueOnce(snapshot(22));
    const second = { id: "plugin:atom65.reaplugin:atom65:CC:DD", name: "Second" };
    const { rerender } = render(<Atom65DoseEditor profile={profile} integration={{ api: { callPluginEndpoint }, devices, supported: true }} />);
    rerender(<Atom65DoseEditor profile={profile} integration={{ api: { callPluginEndpoint }, devices: [second], supported: true }} />);
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Grind weight (g)" })).toHaveValue(22));
    resolveFirst(snapshot(18));
    await waitFor(() => expect(screen.getByRole("spinbutton", { name: "Grind weight (g)" })).toHaveValue(22));
  });

  it("explains the missing driver or connection without sending requests", () => {
    const callPluginEndpoint = vi.fn();
    const { rerender } = render(<Atom65DoseEditor profile={profile} integration={{ api: { callPluginEndpoint }, devices, supported: false }} />);
    expect(screen.getByText(/Install or update/)).toBeInTheDocument();
    rerender(<Atom65DoseEditor profile={profile} integration={{ api: { callPluginEndpoint }, devices: [], supported: true }} />);
    expect(screen.getByText(/Connect your Atom65/)).toBeInTheDocument();
    expect(callPluginEndpoint).not.toHaveBeenCalled();
  });
});
