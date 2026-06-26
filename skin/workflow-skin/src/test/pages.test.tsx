import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfilePresetGrid } from "../components/ProfilePresetGrid";
import { BagsPage } from "../pages/BagsPage";
import { BrewPage } from "../pages/BrewPage";
import { GrindersPage } from "../pages/GrindersPage";
import { HistoryPage } from "../pages/HistoryPage";
import { LivePage } from "../pages/LivePage";
import { ProfilesPage } from "../pages/ProfilesPage";
import { ScreensaverPage } from "../pages/ScreensaverPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SteamPage } from "../pages/SteamPage";
import { screensaverArt } from "../lib/screensaverArt";
import { screensaverQuotes } from "../lib/screensaverQuotes";
import type { ProfileRecord, ShotRecord } from "../api/types";
import { defaultSkinSettings } from "../state/skinSettings";

const profiles: ProfileRecord[] = [
  { id: "p1", profile: { title: "Blooming" } },
  { id: "p2", profile: { title: "Classic" } }
];
afterEach(() => {
  vi.useRealTimers();
});

describe("ProfilePresetGrid", () => {
  it("applies a slot profile when selected", async () => {
    const onApply = vi.fn();
    render(
      <ProfilePresetGrid
        slots={[{ label: "Light", profileId: "p1" }]}
        profiles={profiles}
        onApply={onApply}
        onEditSlot={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Light Blooming/i }));
    expect(onApply).toHaveBeenCalledWith(profiles[0]);
  });

  it("opens slot editing when the edit control is pressed", async () => {
    const onEditSlot = vi.fn();
    render(
      <ProfilePresetGrid
        slots={[{ label: "Light" }]}
        profiles={profiles}
        onApply={vi.fn()}
        onEditSlot={onEditSlot}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /Edit Light/i }));
    expect(onEditSlot).toHaveBeenCalledWith(0);
  });

  it("highlights the preset using the selected workflow profile", () => {
    render(
      <ProfilePresetGrid
        slots={[
          { label: "Light", profileId: "p1" },
          { label: "Sweet", profileId: "p2" }
        ]}
        profiles={profiles}
        selectedProfileId="p2"
        onApply={vi.fn()}
        onEditSlot={vi.fn()}
      />
    );

    const selectedPreset = screen.getByRole("button", { name: /Sweet Classic/i });

    expect(selectedPreset).toHaveAttribute("aria-current", "true");
    expect(selectedPreset.closest(".preset-button")).toHaveClass("selected");
    expect(screen.getByRole("button", { name: /Light Blooming/i })).not.toHaveAttribute("aria-current");
  });
});

describe("BrewPage", () => {
  it("highlights the preset that matches the selected workflow profile", () => {
    render(
      <BrewPage
        workflow={{ context: { extras: { workflowSkin: { selectedProfileId: "p2" } } } }}
        profiles={profiles}
        bags={[]}
        shots={[]}
        settings={{
          ...defaultSkinSettings,
          shownProfileIds: ["p1", "p2"],
          presetSlots: [
            { label: "Light", profileId: "p1" },
            { label: "Sweet", profileId: "p2" }
          ]
        }}
        onApplyProfile={vi.fn()}
        onEditSlot={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Sweet Classic/i })).toHaveAttribute("aria-current", "true");
  });

  it("does not show a dedicated start brew button on the main page", () => {
    render(
      <BrewPage
        workflow={{ context: { targetDoseWeight: 18, targetYield: 36 } }}
        profiles={profiles}
        bags={[]}
        shots={[]}
        settings={{ ...defaultSkinSettings, shownProfileIds: ["p1", "p2"] }}
        onApplyProfile={vi.fn()}
        onEditSlot={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Start Brew" })).not.toBeInTheDocument();
  });
});

describe("LivePage", () => {
  it("renders a nonblank waiting state when no live samples are available", () => {
    render(<LivePage workflow={{ context: { targetDoseWeight: 18, targetYield: 36 } }} latestShot={null} liveMeasurements={[]} scaleSnapshot={null} />);

    expect(screen.getByRole("heading", { name: "Live Brew" })).toBeInTheDocument();
    expect(screen.getByText("Waiting for live espresso data")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Shot pressure graph" })).toBeInTheDocument();
  });

  it("shows live brew graph and key details", () => {
    render(
      <LivePage
        workflow={{ context: { targetDoseWeight: 18, targetYield: 36 } }}
        activeProfile={{
          id: "p1",
          profile: {
            title: "Blooming",
            steps: [
              { name: "Preinfusion", pump: "pressure", transition: "smooth", seconds: 8, pressure: 3, temperature: 92, sensor: "coffee" },
              {
                name: "Ramp",
                pump: "flow",
                transition: "fast",
                seconds: 20,
                flow: 2.5,
                temperature: 93,
                weight: 36,
                sensor: "coffee",
                exit: { type: "flow", condition: "under", value: 1.4 },
                limiter: { value: 9, range: 0.6 }
              }
            ]
          }
        }}
        latestShot={null}
        liveMeasurements={[
          {
            machine: { timestamp: "2026-06-11T10:00:00.000Z", pressure: 2, flow: 1.2 },
            scale: { weight: 4 }
          },
          {
            machine: {
              timestamp: "2026-06-11T10:00:28.000Z",
              pressure: 8.567,
              targetPressure: 9,
              flow: 2.1,
              targetFlow: 2.4,
              groupTemperature: 92.236,
              targetGroupTemperature: 93,
              mixTemperature: 88.124,
              targetMixTemperature: 93,
              state: { state: "PreparingForShot", substate: "heating" }
            },
            scale: { weight: 36, weightFlow: 1.4 }
          }
        ]}
        scaleSnapshot={{ weight: 36.346, weightFlow: 1.847, timerValue: 28000 }}
      />
    );

    expect(screen.getByRole("heading", { name: "Live Brew" })).toBeInTheDocument();
    const graph = screen.getByRole("img", { name: "Shot pressure graph" });
    expect(graph).toBeInTheDocument();
    expect(graph.closest("section")).toHaveClass("dark-graph-panel");
    expect(graph.closest("section")).not.toHaveClass("light-graph-panel");
    expect(graph.querySelector(".shot-graph-series.pressure")).toHaveAttribute("stroke", "#76d99b");
    expect(graph.querySelector(".shot-graph-series.groupTemperature")).toHaveAttribute("stroke", "#f0a46c");
    expect(graph.querySelectorAll(".shot-graph-series")).toHaveLength(7);
    expect(within(graph).getByText("Target pressure")).toBeInTheDocument();
    expect(within(graph).getByText("Target flow")).toBeInTheDocument();
    expect(within(graph).getByText("Temp / 10")).toBeInTheDocument();
    expect(within(graph).getByText("Target temp")).toBeInTheDocument();
    expect(within(graph).getByText("Weight flow")).toBeInTheDocument();
    expect(screen.getByText("Blooming")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Step" })).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    expect(screen.getByText("Ramp")).toBeInTheDocument();
    expect(screen.getByText("Flow 2.50 mL/s")).toBeInTheDocument();
    expect(screen.getByText("Temp 93.00 °C")).toBeInTheDocument();
    expect(screen.getByText("Weight 36.00 g")).toBeInTheDocument();
    expect(screen.getByText("Exit flow under 1.40")).toBeInTheDocument();
    expect(screen.getByText("Limiter 9.00 +/- 0.60")).toBeInTheDocument();
    expect(screen.getByText("Ends at 28s")).toBeInTheDocument();
    expect(screen.getByLabelText("Weight: 36.35 g")).toBeInTheDocument();
    expect(screen.getByLabelText("Pressure: 8.57 bar")).toBeInTheDocument();
    expect(screen.getByLabelText("Flow: 1.85 g/s")).toBeInTheDocument();
    expect(screen.getByLabelText("Group Temp: 92.24 °C")).toBeInTheDocument();
    expect(screen.getByLabelText("Mix Temp: 88.12 °C")).toBeInTheDocument();
    expect(screen.getByLabelText("State: Heating")).toBeInTheDocument();
    expect(screen.getByLabelText("Substate: Heating")).toBeInTheDocument();
    expect(screen.queryByText("PreparingForShot")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Shot Timer: 28 s")).toBeInTheDocument();
  });

  it("scrolls the live page to the current step card when steps are available", () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });

    try {
      render(
        <LivePage
          workflow={{ context: { targetDoseWeight: 18, targetYield: 36 } }}
          activeProfile={{
            id: "p1",
            profile: {
              title: "Blooming",
              steps: [{ name: "Bloom", pump: "pressure", seconds: 10, pressure: 3 }]
            }
          }}
          latestShot={null}
          liveMeasurements={[{ machine: { timestamp: "2026-06-11T10:00:03.000Z", pressure: 3 }, scale: { weight: 5 } }]}
          scaleSnapshot={null}
        />
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", inline: "nearest" });
    } finally {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: originalScrollIntoView });
    }
  });

  it("does not show the first three seconds of noisy live graph measurements", () => {
    render(
      <LivePage
        workflow={{ context: { targetDoseWeight: 18, targetYield: 36 } }}
        latestShot={null}
        liveMeasurements={[
          { machine: { timestamp: "2026-06-11T10:00:00.000Z", pressure: 12 }, scale: { weight: 2 } },
          { machine: { timestamp: "2026-06-11T10:00:01.100Z", pressure: 10 }, scale: { weight: 4 } },
          { machine: { timestamp: "2026-06-11T10:00:02.100Z", pressure: 7 }, scale: { weight: 10 } },
          { machine: { timestamp: "2026-06-11T10:00:03.100Z", pressure: 7.5 }, scale: { weight: 18 } },
          { machine: { timestamp: "2026-06-11T10:00:04.100Z", pressure: 8 }, scale: { weight: 30 } }
        ]}
        scaleSnapshot={null}
      />
    );

    expect(screen.getByLabelText("Shot Timer: 1 s")).toBeInTheDocument();
    expect(screen.getByLabelText("Weight: 30.00 g")).toBeInTheDocument();
  });

  it("uses the live graph timestamp duration when the scale timer has drifted longer", () => {
    render(
      <LivePage
        workflow={{ context: { targetDoseWeight: 18, targetYield: 36 } }}
        latestShot={null}
        liveMeasurements={[
          { machine: { timestamp: "2026-06-11T10:00:00.000Z", pressure: 11 }, scale: { timestamp: "2026-06-11T10:00:00.000Z", weight: 0 } },
          { machine: { timestamp: "2026-06-11T10:00:03.000Z", pressure: 1 }, scale: { timestamp: "2026-06-11T10:00:03.000Z", weight: 1 } },
          { machine: { timestamp: "2026-06-11T10:00:19.200Z", pressure: 8 }, scale: { timestamp: "2026-06-11T10:00:19.200Z", weight: 36 } }
        ]}
        scaleSnapshot={{ weight: 36, weightFlow: 0, timerValue: 18_500 }}
      />
    );

    expect(screen.getByLabelText("Shot Timer: 16 s")).toBeInTheDocument();
    expect(screen.queryByLabelText("Shot Timer: 19 s")).not.toBeInTheDocument();
  });
});

describe("BagsPage", () => {
  it("saves a valid draft bag through the provided callback", async () => {
    const onSaveBag = vi.fn().mockResolvedValue(undefined);
    render(<BagsPage bags={[]} onSaveBag={onSaveBag} />);

    expect(screen.queryByRole("form", { name: /Create a bag/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add Bag" }));
    const form = screen.getByRole("form", { name: /Create a bag/i });

    await userEvent.type(within(form).getByLabelText("Bag Name"), "Morning bag");
    await userEvent.type(within(form).getByLabelText("Roaster"), "Pilot");
    await userEvent.type(within(form).getByLabelText("Bean"), "Ethiopia Halo");
    await userEvent.type(within(form).getByLabelText("Country"), "Ethiopia");
    await userEvent.type(within(form).getByLabelText("Process"), "Washed");
    await userEvent.type(within(form).getByLabelText("Roast Date"), "2026-06-01");
    await userEvent.type(within(form).getByLabelText("Roast Level"), "Light");
    await userEvent.type(within(form).getByLabelText("Notes"), "Citrus");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));

    expect(onSaveBag).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Morning bag",
        roaster: "Pilot",
        bean: "Ethiopia Halo",
        country: "Ethiopia",
        process: "Washed",
        roastDate: "2026-06-01",
        roastLevel: "Light",
        notes: "Citrus"
      })
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Bag saved");
    expect(screen.queryByRole("form", { name: /Create a bag/i })).not.toBeInTheDocument();
  });

  it("shows an inline validation message for invalid draft bags", async () => {
    const onSaveBag = vi.fn();
    render(<BagsPage bags={[]} onSaveBag={onSaveBag} />);

    await userEvent.click(screen.getByRole("button", { name: "Add Bag" }));
    const form = screen.getByRole("form", { name: /Create a bag/i });
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));

    expect(onSaveBag).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("to consider this a bag for suggestions and future features fill all mandatory fields");
    expect(screen.getByText("Mandatory for bag suggestions: roaster, bean, country, process, and roast date.")).toBeInTheDocument();
  });

  it("includes an optional bag name field and marks mandatory bag fields", () => {
    render(<BagsPage bags={[]} onSaveBag={vi.fn()} />);

    const heading = screen.getByRole("heading", { name: "Bags" });
    const addBagButton = screen.getByRole("button", { name: "Add Bag" });
    const filterFields = screen.getByRole("heading", { name: "Bag Filters" }).closest(".panel")!;
    const filterLabels = Array.from(filterFields.querySelectorAll("label")).map((label) => label.textContent?.trim());
    expect(heading.closest(".page-title-row")).toContainElement(addBagButton);
    expect(screen.getByText("Bag Filters").compareDocumentPosition(addBagButton) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Bag" })?.closest(".panel")).toBeNull();
    expect(screen.getByRole("heading", { name: "Bag Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Bag" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create a bag" })).not.toBeInTheDocument();
    expect(filterLabels.slice(0, 2)).toEqual(["Roaster", "Bag Name"]);
  });

  it("filters bags by optional bag name", async () => {
    render(
      <BagsPage
        bags={[
          { id: "bag-1", beanId: "bean-1", name: "Morning Dial", roaster: "Pilot", bean: "Halo", country: "Ethiopia", process: "Washed", roastDate: "2026-06-01" },
          { id: "bag-2", beanId: "bean-2", name: "Evening", roaster: "April", bean: "Nansebo", country: "Ethiopia", process: "Natural", roastDate: "2026-06-02" }
        ]}
        onSaveBag={vi.fn()}
      />
    );

    expect(screen.getByText("Morning Dial")).toBeInTheDocument();
    expect(screen.getByText("Evening")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Bag Name"), "morning");

    expect(screen.getByText("Morning Dial")).toBeInTheDocument();
    expect(screen.queryByText("Evening")).not.toBeInTheDocument();
  });

  it("opens the add bag card with optional name and mandatory bag fields", async () => {
    render(<BagsPage bags={[]} onSaveBag={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Add Bag" }));

    expect(screen.getByRole("heading", { name: "Create a bag" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bag Filters" }).compareDocumentPosition(screen.getByRole("form", { name: /Create a bag/i })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(within(screen.getByRole("form", { name: /Create a bag/i })).getByLabelText("Bag Name")).toBeInTheDocument();
    expect(screen.getByText("Roaster *")).toBeInTheDocument();
    expect(screen.getByText("Bean *")).toBeInTheDocument();
    expect(screen.getByText("Country *")).toBeInTheDocument();
    expect(screen.getByText("Process *")).toBeInTheDocument();
    expect(screen.getByText("Roast Date *")).toBeInTheDocument();
  });

  it("edits existing bag records without showing grinder setup", async () => {
    const onUpdateBag = vi.fn().mockResolvedValue(undefined);
    render(
      <BagsPage
        {...({
          bags: [
            {
              id: "batch-1",
              beanId: "bean-1",
              roaster: "Pilot",
              bean: "Halo",
              country: "Ethiopia",
              process: "Washed",
              roastDate: "2026-06-01",
              roastLevel: "Light"
            }
          ],
          grinders: [{ id: "grinder-1", model: "ZP6", settingType: "numeric", notes: "Travel" }],
          onSaveBag: vi.fn(),
          onUpdateBag,
          onArchiveBag: vi.fn()
        } as any)}
      />
    );

    expect(screen.queryByRole("heading", { name: "Grinders" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Grinder model")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /Edit a bag/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit Pilot Halo" }));
    const form = screen.getByRole("form", { name: /Edit a bag/i });
    await userEvent.clear(within(form).getByLabelText("Roaster"));
    await userEvent.type(within(form).getByLabelText("Roaster"), "April");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));

    expect(onUpdateBag).toHaveBeenCalledWith(expect.objectContaining({ id: "batch-1", beanId: "bean-1", roaster: "April" }));
  });
});

describe("HistoryPage", () => {
  const historyBags = [
    {
      id: "bag-1",
      beanId: "bean-1",
      name: "Morning bag",
      roaster: "Pilot",
      bean: "Halo",
      country: "Ethiopia",
      region: "Yirgacheffe",
      process: "Washed",
      roastDate: "2026-06-01",
      roastLevel: "Light"
    },
    {
      id: "bag-2",
      beanId: "bean-2",
      name: "Night bag",
      roaster: "April",
      bean: "Finca Las Flores",
      country: "Colombia",
      region: "Huila",
      process: "Natural",
      roastDate: "2026-05-18",
      roastLevel: "Medium"
    }
  ];
  const historyShots: ShotRecord[] = [
    {
      id: "shot-1",
      timestamp: "2026-06-12T08:00:00.000Z",
      workflow: { profile: { title: "Blooming espresso" }, context: { beanBatchId: "bag-1" } },
      annotations: { drinkEy: 20.1, espressoNotes: "Citrus" }
    },
    {
      id: "shot-2",
      timestamp: "2026-06-12T09:00:00.000Z",
      workflow: { profile: { title: "Turbo flow" }, context: { beanBatchId: "bag-2" } },
      annotations: { drinkEy: 18.4 }
    }
  ];

  it("searches history by profile and every bag filter", async () => {
    render(<HistoryPage shots={historyShots} bags={historyBags} />);

    expect(screen.getByText("Blooming espresso")).toBeInTheDocument();
    expect(screen.getByText("Turbo flow")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("History search"), "citrus");
    expect(screen.getByText("Blooming espresso")).toBeInTheDocument();
    expect(screen.queryByText("Turbo flow")).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("History search"));

    await userEvent.type(screen.getByLabelText("Profile"), "turbo");
    expect(screen.queryByText("Blooming espresso")).not.toBeInTheDocument();
    expect(screen.getByText("Turbo flow")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Profile"));

    for (const [label, value, visibleProfile, hiddenProfile] of [
      ["Bag Name", "morning", "Blooming espresso", "Turbo flow"],
      ["Roaster", "april", "Turbo flow", "Blooming espresso"],
      ["Bean", "halo", "Blooming espresso", "Turbo flow"],
      ["Country", "colombia", "Turbo flow", "Blooming espresso"],
      ["Region", "yirgacheffe", "Blooming espresso", "Turbo flow"],
      ["Process", "natural", "Turbo flow", "Blooming espresso"],
      ["Roast Date", "2026-06-01", "Blooming espresso", "Turbo flow"],
      ["Roast Type", "medium", "Turbo flow", "Blooming espresso"]
    ] as const) {
      await userEvent.type(screen.getByLabelText(label), value);
      expect(screen.getByText(visibleProfile)).toBeInTheDocument();
      expect(screen.queryByText(hiddenProfile)).not.toBeInTheDocument();
      await userEvent.clear(screen.getByLabelText(label));
    }
  });

  it("shows ranking color and opens a shot review from history", async () => {
    const onOpenShot = vi.fn();
    render(
      <HistoryPage
        shots={[
          {
            ...historyShots[0],
            annotations: { ...historyShots[0].annotations, enjoyment: 10, extras: { workflowSkin: { goldenShot: true } } }
          },
          {
            ...historyShots[1],
            annotations: { ...historyShots[1].annotations, enjoyment: 4 }
          }
        ]}
        bags={historyBags}
        onOpenShot={onOpenShot}
      />
    );

    const goldShot = screen.getByRole("button", { name: "Open shot review for Blooming espresso" });
    expect(goldShot).toHaveClass("history-shot-row", "history-shot-row-compact", "taste-gold", "golden");
    const goldRank = within(goldShot).getByText("10/10 🔥");
    expect(goldRank).toHaveClass("history-rating", "gold");
    expect(goldShot.querySelector(".history-shot-card-header")).not.toBeNull();
    expect(goldRank.closest(".history-shot-card-header")).toBe(goldShot.querySelector(".history-shot-card-header"));

    const yellowShot = screen.getByRole("button", { name: "Open shot review for Turbo flow" });
    expect(yellowShot).toHaveClass("history-shot-row", "history-shot-row-compact", "taste-yellow");
    const yellowRank = within(yellowShot).getByText("4/10");
    expect(yellowRank).toHaveClass("history-rating", "yellow");
    expect(yellowShot.querySelector(".history-shot-card-header")).not.toBeNull();
    expect(yellowRank.closest(".history-shot-card-header")).toBe(yellowShot.querySelector(".history-shot-card-header"));

    await userEvent.click(goldShot);
    expect(onOpenShot).toHaveBeenCalledWith(expect.objectContaining({ id: "shot-1" }));
  });

  it("starts a community recommendation from a history shot", async () => {
    const onRecommendShot = vi.fn();
    render(
      <HistoryPage
        shots={[
          {
            ...historyShots[0],
            workflow: { ...historyShots[0].workflow, profile: { title: "Blooming espresso" } },
            annotations: { ...historyShots[0].annotations, enjoyment: 8 }
          }
        ]}
        bags={historyBags}
        onRecommendShot={onRecommendShot}
      />
    );

    const recommendButton = screen.getByRole("button", { name: "Recommend profile from Blooming espresso" });
    expect(within(recommendButton).queryByText("Recommend")).not.toBeInTheDocument();
    expect(recommendButton.querySelector("svg")).toBeInTheDocument();
    expect(recommendButton.querySelector(".lucide-upload")).not.toBeInTheDocument();
    await userEvent.click(recommendButton);

    expect(onRecommendShot).toHaveBeenCalledWith(expect.objectContaining({ id: "shot-1" }));
  });

  it("filters history to golden shots", async () => {
    render(
      <HistoryPage
        shots={[
          {
            ...historyShots[0],
            annotations: { ...historyShots[0].annotations, enjoyment: 10, extras: { workflowSkin: { goldenShot: true } } }
          },
          historyShots[1]
        ]}
        bags={historyBags}
      />
    );

    expect(screen.getByText("Blooming espresso")).toBeInTheDocument();
    expect(screen.getByText("Turbo flow")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Gold shots" }));

    expect(screen.getByText("Blooming espresso")).toBeInTheDocument();
    expect(screen.queryByText("Turbo flow")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gold shots" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("SteamPage", () => {
  it("shows recent ReaPrime steam history", () => {
    render(
      <SteamPage
        {...({
          profileTitle: "Flat white",
          timers: { small: 20, medium: 30, large: 40 },
          onReview: vi.fn(),
          steamHistory: [
            {
              id: "steam-1",
              timestamp: "2026-06-11T08:15:00.000Z",
              measurements: [{ steam: { temperature: 42 } }, { steam: { temperature: 58 } }],
              annotations: { notes: "Silky 150ml" }
            }
          ]
        } as any)}
      />
    );

    expect(screen.getByRole("heading", { name: "Steam History" })).toBeInTheDocument();
    expect(screen.getByText("Silky 150ml")).toBeInTheDocument();
    expect(screen.getByText(/2 samples/i)).toBeInTheDocument();
  });

  it("starts and stops steaming from the selected timer", async () => {
    vi.useFakeTimers();
    const onStartSteam = vi.fn();
    const onStopSteam = vi.fn();
    render(
      <SteamPage
        {...({
          profileTitle: "Flat white",
          timers: { small: 2, medium: 30, large: 40 },
          onReview: vi.fn(),
          onStartSteam,
          onStopSteam
        } as any)}
      />
    );

    fireEvent.click(within(screen.getByLabelText("Steam timer presets")).getByRole("button", { name: /Small jug/i }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(onStartSteam).toHaveBeenCalledTimes(1);
    expect(onStopSteam).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(onStopSteam).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onStopSteam).toHaveBeenCalledTimes(1);
  });

  it("starts the selected timer when native steaming begins from GHC", async () => {
    vi.useFakeTimers();
    const onStartSteam = vi.fn();
    const onStopSteam = vi.fn();
    const props = {
      profileTitle: "Flat white",
      timers: { small: 2, medium: 30, large: 40 },
      onReview: vi.fn(),
      onStartSteam,
      onStopSteam
    };
    const { rerender } = render(<SteamPage {...props} steamActive={false} />);

    fireEvent.click(within(screen.getByLabelText("Steam timer presets")).getByRole("button", { name: /Small jug/i }));
    rerender(<SteamPage {...props} steamActive />);

    expect(onStartSteam).not.toHaveBeenCalled();
    expect(onStopSteam).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(onStopSteam).toHaveBeenCalledTimes(1);
  });

  it("keeps counting down during parent rerenders while native steam stays active", async () => {
    vi.useFakeTimers();
    const props = {
      profileTitle: "Flat white",
      timers: { small: 20, medium: 20, large: 40 },
      onReview: vi.fn(),
      onStartSteam: vi.fn()
    };
    const { rerender } = render(<SteamPage {...props} onStopSteam={vi.fn()} steamActive />);

    expect(screen.getByText("0:20")).toBeInTheDocument();

    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      rerender(<SteamPage {...props} onStopSteam={vi.fn()} steamActive />);
    }

    expect(screen.getByText("0:18")).toBeInTheDocument();
  });

  it("edits, adds, removes, and caps steam timers at four", async () => {
    const onUpdateTimers = vi.fn();
    render(
      <SteamPage
        profileTitle="Flat white"
        timers={{ small: 20, medium: 30, large: 40 }}
        onReview={vi.fn()}
        onUpdateTimers={onUpdateTimers}
      />
    );

    fireEvent.change(screen.getByLabelText("Timer seconds Medium jug"), { target: { value: "36" } });
    expect(onUpdateTimers).toHaveBeenLastCalledWith({ small: 20, medium: 36, large: 40 });

    await userEvent.click(screen.getByRole("button", { name: "Add timer" }));
    expect(onUpdateTimers).toHaveBeenLastCalledWith({ small: 20, medium: 36, large: 40, "timer-4": 30 });
    expect(screen.getByRole("button", { name: "Add timer" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Timer name Timer 4"), { target: { value: "Cortado" } });
    expect(onUpdateTimers).toHaveBeenLastCalledWith({ small: 20, medium: 36, large: 40, cortado: 30 });

    await userEvent.click(screen.getByRole("button", { name: "Remove Small jug timer" }));
    expect(onUpdateTimers).toHaveBeenLastCalledWith({ medium: 36, large: 40, cortado: 30 });
    expect(screen.getByRole("button", { name: "Add timer" })).not.toBeDisabled();
  });
});

describe("ProfilesPage", () => {
  it("searches profiles and filters pressure based profiles", async () => {
    render(
      <ProfilesPage
        profiles={[
          { id: "pressure", profile: { title: "Spring Lever", steps: [{ pressure: 8 }] } },
          { id: "flow", profile: { title: "Turbo Flow", steps: [{ flow: 4 }] } }
        ]}
        settings={defaultSkinSettings}
        onToggleReview={vi.fn()}
        onSetStartupProfile={vi.fn()}
        onSetProfileShown={vi.fn()}
        onUpdateProfileWorkflow={vi.fn()}
        onSaveProfile={vi.fn()}
      />
    );

    await userEvent.type(screen.getByLabelText("Search profiles"), "spring");
    expect(screen.getByText("Spring Lever")).toBeInTheDocument();
    expect(screen.queryByText("Turbo Flow")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search profiles"));
    await userEvent.selectOptions(screen.getByLabelText("Profile type"), "pressure");

    expect(screen.getByText("Spring Lever")).toBeInTheDocument();
    expect(screen.queryByText("Turbo Flow")).not.toBeInTheDocument();
  });

  it("selects a startup default profile", async () => {
    const onSetStartupProfile = vi.fn();
    render(
      <ProfilesPage
        profiles={profiles}
        settings={defaultSkinSettings}
        onToggleReview={vi.fn()}
        onSetStartupProfile={onSetStartupProfile}
        onSetProfileShown={vi.fn()}
        onUpdateProfileWorkflow={vi.fn()}
        onSaveProfile={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("radio", { name: /Use Blooming at startup/i }));

    expect(onSetStartupProfile).toHaveBeenCalledWith("p1");
  });

  it("edits milk workflow timers for a profile", async () => {
    const onUpdateProfileWorkflow = vi.fn();
    render(
      <ProfilesPage
        profiles={profiles}
        settings={{
          ...defaultSkinSettings,
          profileWorkflows: {
            p1: { milkBased: true, steamTimers: { small: 20, medium: 30, large: 40 } }
          }
        }}
        onToggleReview={vi.fn()}
        onSetStartupProfile={vi.fn()}
        onSetProfileShown={vi.fn()}
        onUpdateProfileWorkflow={onUpdateProfileWorkflow}
        onSaveProfile={vi.fn()}
      />
    );

    const row = screen.getByRole("group", { name: "Blooming profile workflow" });
    fireEvent.change(within(row).getByLabelText("Medium jug seconds"), { target: { value: "36" } });

    expect(onUpdateProfileWorkflow).toHaveBeenLastCalledWith("p1", {
      milkBased: true,
      steamTimers: { small: 20, medium: 36, large: 40 }
    });
  });

  it("toggles whether a profile is shown in the skin picker", async () => {
    const onSetProfileShown = vi.fn();
    render(
      <ProfilesPage
        profiles={profiles}
        settings={defaultSkinSettings}
        onToggleReview={vi.fn()}
        onSetStartupProfile={vi.fn()}
        onSetProfileShown={onSetProfileShown}
        onUpdateProfileWorkflow={vi.fn()}
        onSaveProfile={vi.fn()}
      />
    );

    const row = screen.getByRole("group", { name: "Blooming profile workflow" });
    const toggle = within(row).getByRole("checkbox", { name: "Show in preset picker" });

    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);

    expect(onSetProfileShown).toHaveBeenCalledWith("p1", true);
  });

  it("edits and saves profile details", async () => {
    const onSaveProfile = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfilesPage
        profiles={profiles}
        settings={defaultSkinSettings}
        onToggleReview={vi.fn()}
        onSetStartupProfile={vi.fn()}
        onSetProfileShown={vi.fn()}
        onUpdateProfileWorkflow={vi.fn()}
        onSaveProfile={onSaveProfile}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit Blooming" }));
    await userEvent.clear(screen.getByLabelText("Profile title"));
    await userEvent.type(screen.getByLabelText("Profile title"), "Blooming v2");
    await userEvent.type(screen.getByLabelText("Author"), "Roy");
    await userEvent.click(screen.getByRole("button", { name: "Save Blooming" }));

    expect(onSaveProfile).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        title: "Blooming v2",
        author: "Roy"
      })
    );
  });

  it("edits profile steps, exits, and limits while preserving unknown step fields", async () => {
    const onSaveProfile = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfilesPage
        profiles={[
          {
            id: "p1",
            profile: {
              title: "Blooming",
              steps: [
                {
                  name: "Bloom",
                  pump: "pressure",
                  transition: "smooth",
                  seconds: 10,
                  weight: 0,
                  volume: 40,
                  temperature: 92,
                  sensor: "coffee",
                  pressure: 2,
                  exit: { type: "pressure", condition: "over", value: 3 },
                  limiter: { value: 8, range: 0.6 },
                  customField: "keep-me"
                }
              ]
            }
          }
        ]}
        settings={defaultSkinSettings}
        onToggleReview={vi.fn()}
        onSetStartupProfile={vi.fn()}
        onSetProfileShown={vi.fn()}
        onUpdateProfileWorkflow={vi.fn()}
        onSaveProfile={onSaveProfile}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Edit Blooming" }));

    expect(screen.getByRole("heading", { name: "Profile Steps" })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Step 1 name"));
    await userEvent.type(screen.getByLabelText("Step 1 name"), "Saturate");
    fireEvent.change(screen.getByLabelText("Step 1 pressure goal"), { target: { value: "3.5" } });
    fireEvent.change(screen.getByLabelText("Step 1 limiter value"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Step 1 limiter range"), { target: { value: "0.4" } });
    fireEvent.change(screen.getByLabelText("Step 1 exit type"), { target: { value: "flow" } });
    fireEvent.change(screen.getByLabelText("Step 1 exit condition"), { target: { value: "under" } });
    fireEvent.change(screen.getByLabelText("Step 1 exit value"), { target: { value: "1.4" } });
    await userEvent.click(screen.getByRole("button", { name: "Add step" }));
    await userEvent.click(screen.getByRole("button", { name: "Save Blooming" }));

    expect(onSaveProfile).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({
        steps: [
          expect.objectContaining({
            name: "Saturate",
            pump: "pressure",
            pressure: 3.5,
            exit: { type: "flow", condition: "under", value: 1.4 },
            limiter: { value: 9, range: 0.4 },
            customField: "keep-me"
          }),
          expect.objectContaining({
            name: "New step",
            pump: "pressure"
          })
        ]
      })
    );
  });
});

describe("SettingsPage", () => {
  it("does not show the removed skin title setting", () => {
    render(<SettingsPage settings={defaultSkinSettings} r2Sensor={null} onUpdateSettings={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "Skin settings" }));

    expect(screen.queryByLabelText("Skin title")).not.toBeInTheDocument();
  });

  it("does not show the removed creator setting", async () => {
    render(<SettingsPage settings={defaultSkinSettings} r2Sensor={null} onUpdateSettings={vi.fn()} />);

    expect(screen.queryByText("Creator")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Skin settings" }));
    expect(screen.queryByText("Roy Ackerman")).not.toBeInTheDocument();
  });

  it("shows native display controls and Visualizer plugin status", async () => {
    const onUpdateSettings = vi.fn();
    render(
      <SettingsPage
        {...({
          settings: { ...defaultSkinSettings, keepScreenAwake: true, screensaverBrightness: 8 },
          r2Sensor: null,
          visualizerPlugin: { id: "visualizer.reaplugin", name: "Visualizer upload", loaded: true, autoLoad: true, version: "1.3.0" },
          visualizerSettings: { Username: "roy", Password: "secret", AutoUpload: true, BackSync: true },
          visualizerStatus: {
            status: { status: "online" },
            lastUpload: { reaId: "shot-1", visId: "vis-1" },
            backSyncStatus: { enabled: true, lastResult: "applied 2", lastError: null },
            forwardSyncStatus: { lastResult: "synced", lastError: null }
          },
          displayState: { brightness: 72, wakeLockOverride: true },
          onUpdateSettings
        } as any)}
      />
    );

    expect(screen.getByText("Native display")).toBeInTheDocument();
    expect(screen.getByText("Brightness 72%")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Keep screen awake while the skin is open" })).toBeChecked();
    expect(screen.getByLabelText("Auto sleep after last use")).toHaveValue(30);
    const brightnessSlider = screen.getByRole("slider", { name: "Screensaver brightness" });
    expect(brightnessSlider).toHaveValue("8");
    fireEvent.change(brightnessSlider, { target: { value: "24" } });

    expect(onUpdateSettings).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onUpdateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ screensaverBrightness: 24 }));
    await userEvent.click(screen.getByRole("tab", { name: "App settings" }));
    expect(screen.getByText("Visualizer upload")).toBeInTheDocument();
    expect(screen.getByText("Loaded · Auto-load on · v1.3.0")).toBeInTheDocument();
    expect(screen.getByText("Credentials configured · Auto upload on · Back-sync on")).toBeInTheDocument();
    expect(screen.getByText("Last upload vis-1 from shot-1")).toBeInTheDocument();
  });

  it("edits the auto sleep timer before saving settings", async () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPage settings={defaultSkinSettings} r2Sensor={null} onUpdateSettings={onUpdateSettings} />);

    fireEvent.change(screen.getByLabelText("Auto sleep after last use"), { target: { value: "45" } });

    fireEvent.click(screen.getByRole("tab", { name: "Skin settings" }));
    expect(screen.getByLabelText("Measure delay")).toHaveValue(20);
    expect(screen.getByText("Delay is in seconds after the shot is done brewing and the skin moves to the Review page.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Measure delay"), { target: { value: "55" } });

    expect(onUpdateSettings).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onUpdateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ autoSleepMinutes: 45, r2MeasureDelaySeconds: 55 }));
  });

  it("shows Beanie machine settings and keeps R2 controls under skin settings", async () => {
    const onSaveMachineSettings = vi.fn().mockResolvedValue(undefined);
    const onResetMachineSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsPage
        {...({
          settings: { ...defaultSkinSettings, r2SensorId: "r2-sensor" },
          r2Sensor: null,
          machineSettings: {
            usb: true,
            fan: 40,
            flushTemp: 90,
            flushFlow: 6,
            flushTimeout: 5,
            hotWaterFlow: 6,
            steamFlow: 1.2,
            tankTemp: 0,
            steamPurgeMode: 0
          },
          advancedMachineSettings: {
            heaterPh1Flow: 4,
            heaterPh2Flow: 4,
            heaterIdleTemp: 85,
            heaterPh2Timeout: 10,
            heaterVoltage: 230,
            refillKitSetting: 2
          },
          machineCalibration: { flowMultiplier: 1 },
          onUpdateSettings: vi.fn(),
          onSaveMachineSettings,
          onResetMachineSettings
        } as any)}
      />
    );

    expect(screen.getByLabelText("Tank preheat target")).toHaveValue(0);
    expect(screen.getByLabelText("Steam flow")).toHaveValue(1.2);
    expect(screen.getByLabelText("Steam purge mode")).toHaveValue("0");
    expect(screen.queryByLabelText("Heater phase 1 flow")).not.toBeInTheDocument();
    expect(screen.getByText("Advanced machine settings can change low-level machine behavior. Acknowledge the caution before editing them.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /I understand these advanced settings/i }));
    expect(screen.getByLabelText("Heater phase 1 flow")).toHaveValue(4);
    expect(screen.getByLabelText("Mains voltage hint")).toHaveValue("230");
    expect(screen.getByLabelText("Flow calibration")).toHaveValue(1);
    expect(screen.queryByText("DiFluid R2 status")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Steam flow"), { target: { value: "1.6" } });
    fireEvent.change(screen.getByLabelText("Flow calibration"), { target: { value: "1.08" } });
    await userEvent.click(screen.getByRole("button", { name: "Save machine settings" }));

    expect(onSaveMachineSettings).toHaveBeenCalledWith(
      expect.objectContaining({ steamFlow: 1.6 }),
      expect.objectContaining({ heaterPh1Flow: 4 }),
      expect.objectContaining({ flowMultiplier: 1.08 })
    );

    await userEvent.click(screen.getByRole("button", { name: "Reset machine settings" }));
    expect(onResetMachineSettings).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Skin settings" }));
    expect(screen.getByText("DiFluid R2 status")).toBeInTheDocument();
  });

  it("edits the community API setting without exposing skin updater controls", async () => {
    const onUpdateSettings = vi.fn();
    render(
      <SettingsPage
        {...({
          settings: {
            ...defaultSkinSettings,
            communityApiBaseUrl: "https://old.example.com/community"
          },
          r2Sensor: null,
          onUpdateSettings
        } as any)}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "Skin settings" }));
    expect(screen.getByText("Community")).toBeInTheDocument();
    expect(screen.getByText("Profile recommendations use the WorkFlow community service.")).toBeInTheDocument();
    expect(screen.queryByText("Skin updates")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check for skin updates" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install/update from GitHub release" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("GitHub repo")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Community API"));
    await userEvent.type(screen.getByLabelText("Community API"), "https://new.example.com/community");

    expect(onUpdateSettings).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onUpdateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        communityApiBaseUrl: "https://new.example.com/community"
      })
    );
  });

  it("edits the number of preset cards and their titles before saving settings", async () => {
    const onUpdateSettings = vi.fn();
    render(
      <SettingsPage
        settings={{
          ...defaultSkinSettings,
          presetSlotCount: 2,
          presetSlots: [
            { label: "Light", profileId: "p1" },
            { label: "Turbo", profileId: "p2" }
          ]
        }}
        r2Sensor={null}
        onUpdateSettings={onUpdateSettings}
      />
    );

    await userEvent.click(screen.getByRole("tab", { name: "Skin settings" }));
    fireEvent.change(screen.getByLabelText("Preset cards on main page"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Preset 2 title"), { target: { value: "Milk" } });

    expect(onUpdateSettings).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onUpdateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presetSlotCount: 3,
        presetSlots: [
          { label: "Light", profileId: "p1" },
          { label: "Milk", profileId: "p2" },
          { label: "Turbo" }
        ]
      })
    );
  });

  it("lets preset count be cleared and retyped before saving eight main-page presets", async () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPage settings={defaultSkinSettings} r2Sensor={null} onUpdateSettings={onUpdateSettings} />);

    await userEvent.click(screen.getByRole("tab", { name: "Skin settings" }));
    const presetCount = screen.getByLabelText("Preset cards on main page") as HTMLInputElement;
    await userEvent.clear(presetCount);

    expect(presetCount.value).toBe("");

    await userEvent.type(presetCount, "8");

    expect(presetCount.value).toBe("8");
    expect(screen.getByLabelText("Preset 8 title")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onUpdateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presetSlotCount: 8,
        presetSlots: expect.arrayContaining([expect.objectContaining({ label: "Preset 8" })])
      })
    );
  });

  it("edits skin font size and editable theme options before saving settings", async () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPage settings={defaultSkinSettings} r2Sensor={null} onUpdateSettings={onUpdateSettings} />);

    await userEvent.click(screen.getByRole("tab", { name: "Skin settings" }));
    fireEvent.change(screen.getByRole("slider", { name: "Skin font size" }), { target: { value: "112" } });
    await userEvent.clear(screen.getByLabelText("Slate Citrus theme name"));
    await userEvent.type(screen.getByLabelText("Slate Citrus theme name"), "Roy Slate");
    fireEvent.change(screen.getByLabelText("Slate Citrus accent color"), { target: { value: "#66ccff" } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Scale" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Pressure" }));
    await userEvent.click(screen.getByRole("button", { name: "Use Roy Slate" }));
    await userEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(onUpdateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        skinFontScale: 112,
        skinThemeId: "slate",
        customSkinThemes: expect.objectContaining({
          slate: expect.objectContaining({ name: "Roy Slate", accent: "#66ccff" })
        }),
        topStatusIndicatorIds: expect.arrayContaining(["pressure"])
      })
    );
    const savedSettings = onUpdateSettings.mock.calls[onUpdateSettings.mock.calls.length - 1]?.[0];
    expect(savedSettings.topStatusIndicatorIds).not.toContain("scale");
  });

  it("keeps main menu editing out of app settings", () => {
    render(<SettingsPage settings={defaultSkinSettings} r2Sensor={null} onUpdateSettings={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: "App settings" }));

    expect(screen.queryByText("Main menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit main menu in sidebar" })).not.toBeInTheDocument();
  });
});

describe("BrewPage workflow controls", () => {
  it("shows up to eight main page presets in two rows of four", () => {
    render(
      <BrewPage
        workflow={{ context: { targetDoseWeight: 18 } }}
        profiles={profiles}
        bags={[]}
        grinders={[]}
        shots={[]}
        settings={{
          ...defaultSkinSettings,
          presetSlotCount: 8,
          presetSlots: Array.from({ length: 8 }, (_, index) => ({ label: `Slot ${index + 1}`, profileId: index < 2 ? `p${index + 1}` : undefined })),
          shownProfileIds: ["p1", "p2"]
        }}
        onApplyProfile={vi.fn()}
        onEditSlot={vi.fn()}
      />
    );

    expect(screen.getAllByRole("button", { name: /^Slot \d /i })).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Slot 8 Choose profile" })).toBeInTheDocument();
  });

  it("uses a fixed 1: ratio control to calculate recipe yield from dose", async () => {
    const onUpdateRecipe = vi.fn();
    render(
      <BrewPage
        workflow={{ context: { targetDoseWeight: 18 } }}
        profiles={profiles}
        bags={[]}
        grinders={[]}
        shots={[]}
        settings={{ ...defaultSkinSettings, presetSlotCount: 2, shownProfileIds: ["p1", "p2"] }}
        onApplyProfile={vi.fn()}
        onEditSlot={vi.fn()}
        onUpdateRecipe={onUpdateRecipe}
      />
    );

    expect(screen.getByText("1:")).toBeInTheDocument();
    expect(screen.getByLabelText("Ratio")).toHaveValue(2);
    expect(screen.getByLabelText("Dose")).toHaveValue("18");
    expect(screen.getByLabelText("Yield")).toHaveValue("36");

    fireEvent.change(screen.getByLabelText("Ratio"), { target: { value: "2.5" } });
    expect(screen.getByLabelText("Yield")).toHaveValue("45");

    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "20" } });
    expect(screen.getByLabelText("Yield")).toHaveValue("50");

    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    expect(onUpdateRecipe).toHaveBeenCalledWith({ dose: 20, yield: 50 });
  });

  it("highlights the selected profile in the recommended list", () => {
    render(
      <BrewPage
        workflow={{ profile: { title: "Classic" }, context: { targetDoseWeight: 18 } }}
        profiles={profiles}
        bags={[]}
        grinders={[]}
        shots={[]}
        settings={{ ...defaultSkinSettings, presetSlotCount: 2, shownProfileIds: ["p1", "p2"] }}
        onApplyProfile={vi.fn()}
        onEditSlot={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Classic/i })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /Classic/i })).toHaveClass("selected");
  });

  it("edits recipe, changes the current bag, and shows bag-based grind guidance", async () => {
    const onUpdateRecipe = vi.fn();
    const onSelectBag = vi.fn();
    render(
      <BrewPage
        workflow={{ context: { beanBatchId: "bag-1", targetDoseWeight: 18, targetYield: 40 } }}
        profiles={profiles}
        bags={[
          { id: "bag-1", beanId: "bean-1", roaster: "Pilot", bean: "Halo", process: "Washed", roastDate: "2026-06-01" },
          { id: "bag-2", beanId: "bean-2", roaster: "April", bean: "Nansebo", process: "Natural", roastDate: "2026-06-02" }
        ]}
        grinders={[]}
        shots={[
          {
            id: "shot-1",
            timestamp: "2026-06-11T10:00:00Z",
            workflow: { context: { beanBatchId: "bag-1", targetDoseWeight: 19, targetYield: 42, grinderSetting: "5.2" } },
            annotations: { actualDoseWeight: 19, actualYield: 42 }
          },
          {
            id: "shot-2",
            timestamp: "2026-06-10T10:00:00Z",
            workflow: { context: { beanBatchId: "bag-1", targetDoseWeight: 18, targetYield: 40, grinderSetting: "5.4" } },
            annotations: { actualDoseWeight: 18, actualYield: 40 }
          }
        ]}
        settings={{ ...defaultSkinSettings, presetSlotCount: 2, shownProfileIds: ["p1", "p2"] }}
        onApplyProfile={vi.fn()}
        onEditSlot={vi.fn()}
        onUpdateRecipe={onUpdateRecipe}
        onSelectBag={onSelectBag}
      />
    );

    await userEvent.selectOptions(screen.getByLabelText("Current bag"), "bag-2");
    expect(onSelectBag).toHaveBeenCalledWith("bag-2");
    expect(screen.getByText("Suggested grind: 5.2")).toBeInTheDocument();
    expect(screen.getByText("Suggested recipe: 18.5g in / 41g out")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Dose"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Yield"), { target: { value: "45" } });
    await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));

    expect(onUpdateRecipe).toHaveBeenCalledWith({ dose: 20, yield: 45 });
  });
});

describe("GrindersPage", () => {
  it("requires burrs type before saving grinder setup", async () => {
    const onCreateGrinder = vi.fn().mockResolvedValue(undefined);
    render(<GrindersPage grinders={[]} onCreateGrinder={onCreateGrinder} onUpdateGrinder={vi.fn()} onArchiveGrinder={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Grinder model"), "ZP6");
    expect(screen.getByLabelText("Burrs Type")).toHaveValue("");
    expect(screen.getByRole("option", { name: "Choose Type" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save grinder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Burrs Type is required.");
    expect(onCreateGrinder).not.toHaveBeenCalled();
  });

  it("saves grinder burr data and burrs type", async () => {
    const onCreateGrinder = vi.fn().mockResolvedValue(undefined);
    render(<GrindersPage grinders={[]} onCreateGrinder={onCreateGrinder} onUpdateGrinder={vi.fn()} onArchiveGrinder={vi.fn()} />);

    await userEvent.type(screen.getByLabelText("Grinder model"), "ZP6");
    await userEvent.selectOptions(screen.getByLabelText("Burrs Type"), "flat");
    await userEvent.type(screen.getByLabelText("Burrs"), "MP burrs");
    await userEvent.click(screen.getByRole("button", { name: "Save grinder" }));

    expect(onCreateGrinder).toHaveBeenCalledWith(expect.objectContaining({ model: "ZP6", burrType: "flat", burrs: "MP burrs" }));
  });

  it("stars the default grinder", async () => {
    const onSetDefaultGrinder = vi.fn();
    render(
      <GrindersPage
        grinders={[
          { id: "g1", model: "EK43" },
          { id: "g2", model: "ZP6" }
        ]}
        defaultGrinderId="g1"
        onSetDefaultGrinder={onSetDefaultGrinder}
        onCreateGrinder={vi.fn()}
        onUpdateGrinder={vi.fn()}
        onArchiveGrinder={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "EK43 is default grinder" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Make ZP6 default grinder" }));

    expect(onSetDefaultGrinder).toHaveBeenCalledWith("g2");
  });
});

describe("ScreensaverPage", () => {
  it("has 15 dark generated coffee pictures for sleep mode", () => {
    expect(screensaverArt).toHaveLength(15);
    expect(screensaverQuotes.length).toBeGreaterThanOrEqual(15);
    render(<ScreensaverPage title="WorkFlow" onWake={vi.fn()} />);

    expect(screen.getByLabelText("Screensaver mode")).toHaveStyle({ backgroundColor: "#020506" });
  });

  it("always shows the WorkFlow brand on the screensaver", () => {
    render(<ScreensaverPage title="Roy Decent" onWake={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "WorkFlow" })).toBeInTheDocument();
    expect(screen.queryByText("Roy Decent")).not.toBeInTheDocument();
    const visibleQuote = screensaverQuotes.map((quote) => screen.queryByText(quote)).find(Boolean);
    expect(visibleQuote).toHaveClass("screensaver-subtitle");
  });
});

describe("CommunityPage", () => {
  const recommendation = {
    id: "rec-12345678",
    createdAt: "2026-06-18T13:45:00.000Z",
    updatedAt: "2026-06-18T13:45:00.000Z",
    submittedBy: "Roy",
    rating: 5,
    shotScore: 8,
    bag: { id: "bag-1", beanId: "bean-1", roaster: "Pilot", name: "Halo", bean: "Ethiopia Halo", country: "Ethiopia", process: "Washed", roastDate: "2026-06-01" },
    profile: { originalId: "p1", originalTitle: "Blooming", fileName: "rec-12345678.json", installedTitle: "Blooming - Halo - Roy" },
    grinder: { id: "g1", model: "ZP6", burrType: "flat" as const, burrs: "MP", settingType: "numeric" as const },
    brew: { grindSetting: "4.2", beansWeight: 18, drinkWeight: 42, secondsMin: 28, secondsMax: 34, notes: "Gentle declining pressure" }
  };
  const bags = [{ id: "bag-1", beanId: "bean-1", roaster: "Pilot", name: "Halo", bean: "Ethiopia Halo", country: "Ethiopia", process: "Washed", roastDate: "2026-06-01" }];
  const grinders = [{ id: "g1", model: "ZP6", burrType: "flat" as const, burrs: "MP", settingType: "numeric" as const }];
  const shots = [{ id: "shot-1", timestamp: "2026-06-18T10:00:00.000Z", workflow: { profile: { title: "Blooming" } }, annotations: { enjoyment: 8 } }];

  async function renderCommunityPage(overrides = {}) {
    const { CommunityPage } = await import("../pages/CommunityPage");
    const props = {
      recommendations: [] as typeof recommendation[],
      loading: false,
      error: null,
      bags,
      profiles,
      grinders,
      shots,
      downloaded: [],
      uploaded: [],
      submittedBy: "Roy",
      submittedByLocked: true,
      manualDisplayName: "",
      onManualDisplayNameChange: vi.fn(),
      onRefresh: vi.fn(),
      onDownload: vi.fn(),
      onUpload: vi.fn(),
      onEditUpload: vi.fn(),
      onDeleteUpload: vi.fn(),
      userRatings: {},
      onRateRecommendation: vi.fn(),
      ...overrides
    };
    render(<CommunityPage {...props} />);
    return props;
  }

  async function openRecommendProfile() {
    await userEvent.click(screen.getByRole("tab", { name: "Recommend Profile" }));
  }

  async function fillValidUploadDraft() {
    await userEvent.selectOptions(screen.getByLabelText("Saved bag"), "bag-1");
    await userEvent.selectOptions(screen.getByLabelText("Profile"), "p1");
    await userEvent.selectOptions(screen.getByLabelText("Grinder"), "g1");
    await userEvent.type(screen.getByLabelText("Grind setting"), "4.2");
    await userEvent.type(screen.getByLabelText("Beans weight"), "18");
    await userEvent.type(screen.getByLabelText("Drink weight"), "42");
    await userEvent.type(screen.getByLabelText("Seconds min"), "28");
    await userEvent.type(screen.getByLabelText("Seconds max"), "34");
    await userEvent.type(screen.getByLabelText("Visualizer link"), "https://visualizer.coffee/shots/1");
    await userEvent.selectOptions(screen.getByLabelText("Shot evidence"), "shot-1");
    await userEvent.type(screen.getByLabelText("Notes"), "Gentle declining pressure");
  }

  it("shows shot scores when choosing shot evidence", async () => {
    await renderCommunityPage();
    await openRecommendProfile();

    expect(screen.getByRole("option", { name: "2026-06-18 - Blooming - 8/10" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2026-06-18 - Blooming - 8/10" })).not.toHaveTextContent("10:00");
  });

  it("shows searchable recommendations and download actions", async () => {
    const { CommunityPage } = await import("../pages/CommunityPage");
    render(
      <CommunityPage
        recommendations={[recommendation]}
        loading={false}
        error={null}
        bags={[]}
        profiles={[]}
        grinders={[]}
        shots={[]}
        downloaded={[]}
        uploaded={[]}
        submittedBy="Roy"
        submittedByLocked
        manualDisplayName=""
        onManualDisplayNameChange={vi.fn()}
        onRefresh={vi.fn()}
        onDownload={vi.fn()}
        onUpload={vi.fn()}
        onEditUpload={vi.fn()}
        onDeleteUpload={vi.fn()}
        userRatings={{}}
        onRateRecommendation={vi.fn()}
      />
    );
    expect(screen.getByRole("heading", { name: "Community" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search recommendations"), "zp6");
    expect(screen.getByText("Blooming")).toBeInTheDocument();
    const row = screen.getByText("Blooming").closest(".community-row") as HTMLElement;
    expect(within(row).getByText("Uploaded 2026-06-18 - Shot score 8/10")).toBeInTheDocument();
    expect(row).not.toHaveTextContent("13:45");
    expect(within(row).getByText("ZP6 - MP - Flat burrs - Grind 4.2 - 18g in - 42g out - By Roy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Blooming" })).toBeInTheDocument();
  });

  it("opens recommendation details with shot graph and downloads from the details page", async () => {
    const recommendationWithEvidence = {
      ...recommendation,
      visualizerUrl: "https://visualizer.coffee/shots/abc",
      evidenceFileName: "rec-12345678.json"
    };
    const onLoadDetails = vi.fn().mockResolvedValue({
      recommendation: recommendationWithEvidence,
      profileJson: { title: "Blooming" },
      evidence: {
        id: "shot-1",
        timestamp: "2026-06-18T10:00:00.000Z",
        profileTitle: "Blooming",
        doseWeight: 18,
        drinkWeight: 42,
        tds: 9.2,
        ey: 21.5,
        enjoyment: 8,
        notes: "Sweet and floral",
        measurements: [
          { machine: { timestamp: "2026-06-18T10:00:00.000Z", pressure: 1, flow: 1 }, scale: { timestamp: "2026-06-18T10:00:00.000Z", weight: 0 } },
          { machine: { timestamp: "2026-06-18T10:00:12.000Z", pressure: 8, flow: 2 }, scale: { timestamp: "2026-06-18T10:00:12.000Z", weight: 24 } }
        ]
      }
    });
    const onDownload = vi.fn().mockResolvedValue(undefined);
    await renderCommunityPage({ recommendations: [recommendationWithEvidence], onLoadDetails, onDownload });

    await userEvent.click(screen.getByRole("button", { name: "Open Blooming details" }));

    expect(await screen.findByRole("heading", { name: "Blooming" })).toBeInTheDocument();
    expect(onLoadDetails).toHaveBeenCalledWith(recommendationWithEvidence);
    expect(screen.getByRole("img", { name: "Shot pressure graph" })).toBeInTheDocument();
    expect(screen.getByText("Shot score 8/10")).toBeInTheDocument();
    expect(screen.getByText("Shot date 2026-06-18")).toBeInTheDocument();
    expect(screen.getByText("TDS 9.2")).toBeInTheDocument();
    expect(screen.getByText("EY 21.5%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Visualizer" })).toHaveAttribute("href", "https://visualizer.coffee/shots/abc");

    await userEvent.click(screen.getByRole("img", { name: "Shot pressure graph" }));
    const fullscreenGraph = await screen.findByRole("dialog", { name: "Shot graph fullscreen" });
    expect(fullscreenGraph.parentElement).toBe(document.body);
    expect(within(fullscreenGraph).getByRole("button", { name: "Close shot graph fullscreen" })).toBeInTheDocument();
    expect(within(fullscreenGraph).getByRole("img", { name: "Shot pressure graph" })).toBeInTheDocument();
    await userEvent.click(within(fullscreenGraph).getByRole("button", { name: "Close shot graph fullscreen" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Shot graph fullscreen" })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Download Blooming" }));

    await waitFor(() => expect(onDownload).toHaveBeenCalledWith(recommendationWithEvidence));
    expect(screen.getByRole("status")).toHaveTextContent("Profile downloaded.");
  });

  it("searches and filters recommendations by flat or conical burrs type", async () => {
    const conicalRecommendation = {
      ...recommendation,
      id: "rec-conical",
      profile: { ...recommendation.profile, originalTitle: "Turbo", installedTitle: "Turbo - Halo - Mia" },
      grinder: { ...recommendation.grinder, id: "g2", model: "Niche Zero", burrType: "conical" as const }
    };
    await renderCommunityPage({ recommendations: [recommendation, conicalRecommendation] });

    expect(screen.getByText("Blooming")).toBeInTheDocument();
    expect(screen.getByText("Turbo")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Flat burrs" }));
    expect(screen.getByText("Blooming")).toBeInTheDocument();
    expect(screen.queryByText("Turbo")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Flat burrs" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Conical burrs" }));
    expect(screen.queryByText("Blooming")).not.toBeInTheDocument();
    expect(screen.getByText("Turbo")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search recommendations"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Conical burrs" }));
    await userEvent.type(screen.getByLabelText("Search recommendations"), "flat");
    expect(screen.getByText("Blooming")).toBeInTheDocument();
    expect(screen.queryByText("Turbo")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Search recommendations"));
    await userEvent.type(screen.getByLabelText("Grinder recommendation filter"), "niche");
    expect(screen.queryByText("Blooming")).not.toBeInTheDocument();
    expect(screen.getByText("Turbo")).toBeInTheDocument();
  });

  it("shows recommendation star ratings and filters by minimum stars", async () => {
    const threeStarRecommendation = {
      ...recommendation,
      id: "rec-three-stars",
      rating: 3,
      profile: { ...recommendation.profile, originalTitle: "Classic", installedTitle: "Classic - Halo - Mia" }
    };
    await renderCommunityPage({ recommendations: [recommendation, threeStarRecommendation] });

    const fiveStarRow = screen.getByText("Blooming").closest(".community-row") as HTMLElement;
    const threeStarRow = screen.getByText("Classic").closest(".community-row") as HTMLElement;
    const fiveStarBadge = within(fiveStarRow).getByLabelText("Recommendation rating 5 out of 5 stars");
    const threeStarBadge = within(threeStarRow).getByLabelText("Recommendation rating 3 out of 5 stars");
    expect(fiveStarBadge).toHaveTextContent("⭐⭐⭐⭐⭐");
    expect(threeStarBadge).toHaveTextContent("⭐⭐⭐");
    expect(fiveStarBadge.closest(".community-card-header")).toBe(fiveStarRow.querySelector(".community-card-header"));
    expect(threeStarBadge.closest(".community-card-header")).toBe(threeStarRow.querySelector(".community-card-header"));

    await userEvent.selectOptions(screen.getByLabelText("Minimum recommendation rating"), "4");

    expect(screen.getByText("Blooming")).toBeInTheDocument();
    expect(screen.queryByText("Classic")).not.toBeInTheDocument();
  });

  it("shows community card stars as rounded-up emoji half-star ratings", async () => {
    const averagedRecommendation = {
      ...recommendation,
      rating: 2,
      communityRatingAverage: 4.3,
      communityRatingCount: 6
    };
    await renderCommunityPage({ recommendations: [averagedRecommendation] });

    const row = screen.getByText("Blooming").closest(".community-row") as HTMLElement;
    const badge = within(row).getByLabelText("Recommendation rating 4.5 out of 5 stars");
    expect(badge.closest(".community-card-header")).toBe(row.querySelector(".community-card-header"));
    expect(badge).toHaveTextContent("⭐⭐⭐⭐⭐");
    expect(badge.querySelectorAll(".community-star-full")).toHaveLength(4);
    expect(badge.querySelectorAll(".community-star-half")).toHaveLength(1);

    await userEvent.selectOptions(screen.getByLabelText("Minimum recommendation rating"), "5");
    expect(screen.queryByText("Blooming")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Minimum recommendation rating"), "4");
    expect(screen.getByText("Blooming")).toBeInTheDocument();
  });

  it("sorts recommendations by rank count and uploader score with highest values first", async () => {
    const highUploaderScore = {
      ...recommendation,
      id: "rec-high-uploader-score",
      rating: 5,
      communityRatingAverage: 4.8,
      communityRatingCount: 1,
      profile: { ...recommendation.profile, originalTitle: "High Uploader Score", installedTitle: "High Uploader Score - Halo - Roy" }
    };
    const manyRanksLowScore = {
      ...recommendation,
      id: "rec-many-ranks-low-score",
      rating: 2,
      communityRatingAverage: 3.4,
      communityRatingCount: 9,
      profile: { ...recommendation.profile, originalTitle: "Many Ranks Low Score", installedTitle: "Many Ranks Low Score - Halo - Roy" }
    };
    const manyRanksHighScore = {
      ...recommendation,
      id: "rec-many-ranks-high-score",
      rating: 4,
      communityRatingAverage: 3.9,
      communityRatingCount: 9,
      profile: { ...recommendation.profile, originalTitle: "Many Ranks High Score", installedTitle: "Many Ranks High Score - Halo - Roy" }
    };
    await renderCommunityPage({ recommendations: [highUploaderScore, manyRanksLowScore, manyRanksHighScore] });

    const visibleTitles = () => Array.from(document.querySelectorAll(".community-row-open strong")).map((element) => element.textContent);

    expect(visibleTitles()).toEqual(["High Uploader Score", "Many Ranks Low Score", "Many Ranks High Score"]);

    await userEvent.selectOptions(screen.getByLabelText("Sort recommendations"), "rank-count");
    expect(visibleTitles()).toEqual(["Many Ranks Low Score", "Many Ranks High Score", "High Uploader Score"]);

    await userEvent.selectOptions(screen.getByLabelText("Sort recommendations"), "uploader-rating");
    expect(visibleTitles()).toEqual(["High Uploader Score", "Many Ranks High Score", "Many Ranks Low Score"]);

    await userEvent.selectOptions(screen.getByLabelText("Sort recommendations"), "rank-count-uploader-rating");
    expect(visibleTitles()).toEqual(["Many Ranks High Score", "Many Ranks Low Score", "High Uploader Score"]);
  });

  it("lets people rank recommendations from the list and the detail page", async () => {
    const rankedRecommendation = {
      ...recommendation,
      communityRatingAverage: 4.5,
      communityRatingCount: 2
    };
    const onRateRecommendation = vi.fn().mockResolvedValue(undefined);
    await renderCommunityPage({
      recommendations: [rankedRecommendation],
      userRatings: { [rankedRecommendation.id]: 3 },
      onRateRecommendation
    });

    const row = screen.getByText("Blooming").closest(".community-row") as HTMLElement;
    expect(within(row).getByText("Community rank 4.5/5 (2)")).toBeInTheDocument();
    expect(within(row).getByLabelText("Your rank for Blooming")).toHaveValue("3");

    await userEvent.selectOptions(within(row).getByLabelText("Your rank for Blooming"), "4");

    await waitFor(() => expect(onRateRecommendation).toHaveBeenCalledWith(rankedRecommendation, 4));
    expect(screen.getByRole("status")).toHaveTextContent("Rank saved.");

    await userEvent.click(screen.getByRole("button", { name: "Open Blooming details" }));

    expect(await screen.findByRole("heading", { name: "Blooming" })).toBeInTheDocument();
    expect(screen.getByText("Community rank 4.5/5 (2)")).toBeInTheDocument();
    expect(screen.getByLabelText("Your rank for Blooming")).toHaveValue("3");
  });

  it("shows download success status after the download promise resolves", async () => {
    const onDownload = vi.fn().mockResolvedValue(undefined);
    await renderCommunityPage({ recommendations: [recommendation], onDownload });

    await userEvent.click(screen.getByRole("button", { name: "Download Blooming" }));

    await waitFor(() => expect(onDownload).toHaveBeenCalledWith(recommendation));
    expect(screen.getByRole("status")).toHaveTextContent("Profile downloaded.");
  });

  it("shows a download failure alert and keeps the recommendation visible", async () => {
    const onDownload = vi.fn().mockRejectedValue(new Error("Download failed"));
    await renderCommunityPage({ recommendations: [recommendation], onDownload });

    await userEvent.click(screen.getByRole("button", { name: "Download Blooming" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Download failed");
    expect(screen.getByRole("button", { name: "Download Blooming" })).not.toBeDisabled();
    expect(screen.queryByText("Profile downloaded.")).not.toBeInTheDocument();
  });

  it("requires existing saved bag, profile, grinder, brew values, and notes before upload", async () => {
    const { CommunityPage } = await import("../pages/CommunityPage");
    const onUpload = vi.fn();
    render(
      <CommunityPage
        recommendations={[]}
        loading={false}
        error={null}
        bags={[]}
        profiles={[]}
        grinders={[]}
        shots={[]}
        downloaded={[]}
        uploaded={[]}
        submittedBy={null}
        submittedByLocked={false}
        manualDisplayName=""
        onManualDisplayNameChange={vi.fn()}
        onRefresh={vi.fn()}
        onDownload={vi.fn()}
        onUpload={onUpload}
        onEditUpload={vi.fn()}
        onDeleteUpload={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole("tab", { name: "Recommend Profile" }));
    await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Select a saved bag, profile, grinder, public display name, grind setting, weights, seconds, and notes.");
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("shows upload validation and success messages above the recommendation fields", async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });

    try {
      await renderCommunityPage({ onUpload });
      await openRecommendProfile();

      await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Select a saved bag, profile, grinder, public display name, grind setting, weights, seconds, and notes.");
      expect(alert.compareDocumentPosition(screen.getByLabelText("Saved bag")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });

      scrollIntoView.mockClear();
      await fillValidUploadDraft();
      await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));

      await waitFor(() => expect(onUpload).toHaveBeenCalled());
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("Recommendation uploaded.");
      expect(status.compareDocumentPosition(screen.getByLabelText("Saved bag")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: originalScrollIntoView });
      } else {
        delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
      }
    }
  });

  it("rejects invalid numeric brew values before upload", async () => {
    const onUpload = vi.fn();
    await renderCommunityPage({ onUpload });
    await openRecommendProfile();
    await fillValidUploadDraft();

    await userEvent.clear(screen.getByLabelText("Beans weight"));
    await userEvent.type(screen.getByLabelText("Beans weight"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Select a saved bag, profile, grinder, public display name, grind setting, weights, seconds, and notes.");
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("rejects reversed seconds before upload", async () => {
    const onUpload = vi.fn();
    await renderCommunityPage({ onUpload });
    await openRecommendProfile();
    await fillValidUploadDraft();

    await userEvent.clear(screen.getByLabelText("Seconds min"));
    await userEvent.type(screen.getByLabelText("Seconds min"), "40");
    await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Select a saved bag, profile, grinder, public display name, grind setting, weights, seconds, and notes.");
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("uploads a valid draft, clears fields, and shows success", async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    await renderCommunityPage({ onUpload });
    await openRecommendProfile();
    await fillValidUploadDraft();

    await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));

    await waitFor(() =>
      expect(onUpload).toHaveBeenCalledWith({
        bagId: "bag-1",
        profileId: "p1",
        grinderId: "g1",
        grindSetting: "4.2",
        beansWeight: "18",
        drinkWeight: "42",
        secondsMin: "28",
        secondsMax: "34",
        rating: "5",
        notes: "Gentle declining pressure",
        visualizerUrl: "https://visualizer.coffee/shots/1",
        shotId: "shot-1"
      })
    );
    expect(screen.getByRole("status")).toHaveTextContent("Recommendation uploaded.");
    expect(screen.getByLabelText("Saved bag")).toHaveValue("");
    expect(screen.getByLabelText("Grind setting")).toHaveValue("");
    expect(screen.getByLabelText("Notes")).toHaveValue("");
  });

  it("uploads the selected recommendation star rating", async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);
    await renderCommunityPage({ onUpload });
    await openRecommendProfile();
    await fillValidUploadDraft();
    await userEvent.selectOptions(screen.getByLabelText("Recommendation rating"), "4");

    await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));

    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(expect.objectContaining({ rating: "4" })));
  });

  it("keeps the draft and shows an alert when upload fails", async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error("Community upload failed"));
    await renderCommunityPage({ onUpload });
    await openRecommendProfile();
    await fillValidUploadDraft();

    await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Community upload failed");
    expect(screen.queryByText("Recommendation uploaded.")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Saved bag")).toHaveValue("bag-1");
    expect(screen.getByLabelText("Grind setting")).toHaveValue("4.2");
    expect(screen.getByLabelText("Notes")).toHaveValue("Gentle declining pressure");
  });

  it("shows downloaded profiles with local title, recommendation notes, and evidence details", async () => {
    await renderCommunityPage({
      downloaded: [
        {
          recommendationId: recommendation.id,
          localProfileId: "local-p1",
          localProfileTitle: "Blooming - Halo - Roy",
          downloadedAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
          recommendation,
          evidence: {
            id: "shot-1",
            tds: 8.5,
            ey: 20,
            enjoyment: 8,
            notes: "sweet balance",
            measurements: [{ machine: { pressure: 7 } }]
          }
        }
      ]
    });

    await userEvent.click(screen.getByRole("tab", { name: "Downloaded Profiles" }));

    expect(screen.getByText("Blooming - Halo - Roy")).toBeInTheDocument();
    expect(screen.getByText("Gentle declining pressure")).toBeInTheDocument();
    expect(screen.getByText("Shot score 8/10")).toBeInTheDocument();
    expect(screen.getByText("TDS 8.5")).toBeInTheDocument();
    expect(screen.getByText("EY 20")).toBeInTheDocument();
    expect(screen.getByText("sweet balance")).toBeInTheDocument();
  });

  it("shows uploaded profiles with date-only upload, shot score, bag, and brew details", async () => {
    await renderCommunityPage({
      uploaded: [
        {
          recommendationId: recommendation.id,
          uploadedAt: "2026-06-18T15:30:00.000Z",
          updatedAt: "2026-06-18T15:30:00.000Z",
          recommendation,
          evidence: {
            id: "shot-1",
            enjoyment: 8,
            tds: 8.5,
            ey: 20,
            notes: "sweet balance"
          }
        }
      ]
    });

    await userEvent.click(screen.getByRole("tab", { name: "Uploaded Profiles" }));

    const row = screen.getByText("Blooming").closest(".community-row") as HTMLElement;
    expect(within(row).getByText("Uploaded 2026-06-18 - Shot score 8/10")).toBeInTheDocument();
    expect(row).not.toHaveTextContent("15:30");
    expect(within(row).getByText("Pilot - Halo - Ethiopia Halo - Ethiopia - Washed - 2026-06-01")).toBeInTheDocument();
    expect(within(row).getByText("ZP6 - MP - Flat burrs - Grind 4.2 - 18g in - 42g out - By Roy")).toBeInTheDocument();
    expect(within(row).getByText("TDS 8.5")).toBeInTheDocument();
    expect(within(row).getByText("EY 20")).toBeInTheDocument();
    expect(within(row).getByText("sweet balance")).toBeInTheDocument();
  });

  it("deletes an uploaded profile recommendation from the uploaded profiles list", async () => {
    const onDeleteUpload = vi.fn().mockResolvedValue(undefined);
    await renderCommunityPage({
      onDeleteUpload,
      uploaded: [
        {
          recommendationId: recommendation.id,
          uploadedAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
          recommendation
        }
      ]
    });

    await userEvent.click(screen.getByRole("tab", { name: "Uploaded Profiles" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Blooming" }));

    await waitFor(() => expect(onDeleteUpload).toHaveBeenCalledWith(recommendation));
    expect(screen.getByRole("status")).toHaveTextContent("Recommendation deleted.");
  });

  it("opens an uploaded profile detail editor, validates mandatory fields, and saves the updated draft", async () => {
    const onEditUpload = vi.fn().mockResolvedValue(undefined);
    await renderCommunityPage({
      onEditUpload,
      uploaded: [
        {
          recommendationId: recommendation.id,
          uploadedAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
          recommendation
        }
      ]
    });

    await userEvent.click(screen.getByRole("tab", { name: "Uploaded Profiles" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Blooming" }));

    expect(await screen.findByRole("heading", { name: "Edit Blooming" })).toBeInTheDocument();
    expect(screen.getByLabelText("Grind setting")).toHaveValue("4.2");
    expect(screen.getByLabelText("Seconds min")).toHaveValue("28");

    await userEvent.clear(screen.getByLabelText("Notes"));
    await userEvent.click(screen.getByRole("button", { name: "Save updated recommendation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Select a saved bag, profile, grinder, public display name, grind setting, weights, seconds, and notes.");
    expect(onEditUpload).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Notes"), "Updated tasting note");
    await userEvent.click(screen.getByRole("button", { name: "Save updated recommendation" }));

    await waitFor(() =>
      expect(onEditUpload).toHaveBeenCalledWith(
        recommendation,
        expect.objectContaining({
          bagId: "bag-1",
          profileId: "p1",
          grinderId: "g1",
          grindSetting: "4.2",
          beansWeight: "18",
          drinkWeight: "42",
          secondsMin: "28",
          secondsMax: "34",
          notes: "Updated tasting note"
        })
      )
    );
    expect(screen.getByRole("status")).toHaveTextContent("Recommendation updated.");
  });

  it("deletes an uploaded profile recommendation from the full detail editor", async () => {
    const onDeleteUpload = vi.fn().mockResolvedValue(undefined);
    await renderCommunityPage({
      onDeleteUpload,
      uploaded: [
        {
          recommendationId: recommendation.id,
          uploadedAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
          recommendation
        }
      ]
    });

    await userEvent.click(screen.getByRole("tab", { name: "Uploaded Profiles" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Blooming" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete Blooming" }));

    await waitFor(() => expect(onDeleteUpload).toHaveBeenCalledWith(recommendation));
    expect(screen.getByRole("status")).toHaveTextContent("Recommendation deleted.");
  });

  it("shows an edit failure alert for uploaded recommendations", async () => {
    const onEditUpload = vi.fn().mockRejectedValue(new Error("Original local profile is no longer available."));
    await renderCommunityPage({
      onEditUpload,
      uploaded: [
        {
          recommendationId: recommendation.id,
          uploadedAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
          recommendation
        }
      ]
    });

    await userEvent.click(screen.getByRole("tab", { name: "Uploaded Profiles" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Blooming" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save updated recommendation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Original local profile is no longer available.");
  });
});
