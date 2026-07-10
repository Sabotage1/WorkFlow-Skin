import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProfileRecord } from "../api/types";
import type { DrinkWorkflow, DrinkWorkflowRunState } from "../lib/drinkWorkflows";
import { WorkflowsPage } from "../pages/WorkflowsPage";

const profiles: ProfileRecord[] = [
  { id: "p1", profile: { title: "Classic" } },
  { id: "p2", profile: { title: "Turbo" } }
];

const americano: DrinkWorkflow = {
  id: "americano",
  name: "Americano",
  steps: [
    { id: "brew", type: "brew", profileId: "p1" },
    { id: "water", type: "hotWater", volumeMl: 120, temperatureC: 82 }
  ]
};

const idleRun: DrinkWorkflowRunState = { workflow: null, currentStepIndex: -1, phase: "idle" };

function renderPage(options: { workflows?: DrinkWorkflow[]; run?: DrinkWorkflowRunState } = {}) {
  const callbacks = {
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onStart: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn().mockResolvedValue(undefined)
  };
  render(
    <WorkflowsPage
      workflows={options.workflows ?? []}
      profiles={profiles}
      run={options.run ?? idleRun}
      {...callbacks}
    />
  );
  return callbacks;
}

describe("Work Flows page", () => {
  it("builds and saves an ordered espresso and hot-water recipe", async () => {
    const user = userEvent.setup();
    const callbacks = renderPage();

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Morning Americano");
    await user.selectOptions(screen.getByRole("combobox", { name: "Profile" }), "p2");
    await user.click(screen.getByRole("button", { name: "Add Step" }));
    await user.clear(screen.getByRole("spinbutton", { name: "Water amount (ml)" }));
    await user.type(screen.getByRole("spinbutton", { name: "Water amount (ml)" }), "140");
    await user.clear(screen.getByRole("spinbutton", { name: "Water temperature (C)" }));
    await user.type(screen.getByRole("spinbutton", { name: "Water temperature (C)" }), "84");
    await user.click(screen.getByRole("button", { name: "Save Work Flow" }));

    expect(callbacks.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Morning Americano",
        steps: [
          expect.objectContaining({ type: "brew", profileId: "p2" }),
          expect.objectContaining({ type: "hotWater", volumeMl: 140, temperatureC: 84 })
        ]
      })
    );
  });

  it("moves hot water before espresso with touch-friendly order buttons", async () => {
    const user = userEvent.setup();
    const callbacks = renderPage({ workflows: [americano] });

    await user.click(screen.getByRole("button", { name: "Move step 2 up" }));
    await user.click(screen.getByRole("button", { name: "Save Work Flow" }));

    expect(callbacks.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ steps: [expect.objectContaining({ type: "hotWater" }), expect.objectContaining({ type: "brew" })] })
    );
  });

  it("adds steam as a third action and prevents a fourth action", async () => {
    const user = userEvent.setup();
    renderPage({ workflows: [americano] });

    await user.selectOptions(screen.getByRole("combobox", { name: "Next action" }), "steam");
    await user.click(screen.getByRole("button", { name: "Add Step" }));

    expect(screen.getByRole("spinbutton", { name: "Steam duration (seconds)" })).toHaveValue(30);
    expect(screen.getByRole("spinbutton", { name: "Steam temperature (C)" })).toHaveValue(150);
    expect(screen.getByRole("button", { name: "Add Step" })).toBeDisabled();
  });

  it("starts a saved recipe and renders active sequence progress", async () => {
    const user = userEvent.setup();
    const run: DrinkWorkflowRunState = {
      workflow: americano,
      currentStepIndex: 1,
      phase: "running",
      message: "Hot Water is running."
    };
    const callbacks = renderPage({ workflows: [americano], run });

    expect(screen.getByText("Hot Water is running.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
  });
});
