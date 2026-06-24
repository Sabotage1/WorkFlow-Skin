import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ShotSnapshot } from "../api/types";
import { ShotGraph } from "../components/ShotGraph";

function getByTextContent(text: string) {
  return screen.getByText((_content, element) => element?.tagName.toLowerCase() === "text" && element.textContent === text);
}

function queryByTextContent(text: string) {
  return screen.queryByText((_content, element) => element?.tagName.toLowerCase() === "text" && element.textContent === text);
}

describe("ShotGraph", () => {
  it("uses brewing substates for the x-axis instead of post-shot samples", () => {
    const measurements: ShotSnapshot[] = [
      {
        machine: { timestamp: "2026-06-18T10:00:00.000Z", pressure: 1, state: { state: "espresso", substate: "preinfusion" } },
        scale: { timestamp: "2026-06-18T10:00:00.000Z" }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:12.000Z", pressure: 8, flow: 1.4, state: { state: "espresso", substate: "pouring" } },
        scale: { timestamp: "2026-06-18T10:00:12.000Z", weightFlow: 1.3 }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:23.000Z", pressure: 7, flow: 1.2, state: { state: "espresso", substate: "pouring" } },
        scale: { timestamp: "2026-06-18T10:00:23.000Z", weightFlow: 1.1 }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:31.600Z", pressure: 0, flow: 0, state: { state: "idle", substate: "idle" } },
        scale: { timestamp: "2026-06-18T10:00:31.600Z", weightFlow: 0 }
      }
    ];

    render(<ShotGraph measurements={measurements} />);

    expect(getByTextContent("23s")).toBeInTheDocument();
    expect(queryByTextContent("31.6s")).not.toBeInTheDocument();
  });

  it("uses timestamps instead of scale timer values", () => {
    const measurements: ShotSnapshot[] = [
      {
        machine: { timestamp: "2026-06-18T10:00:00.000Z", pressure: 1, flow: 0.1, state: { state: "espresso", substate: "preinfusion" } },
        scale: { timestamp: "2026-06-18T10:00:00.000Z", timerValue: 0 }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:23.000Z", pressure: 8, flow: 1.4, state: { state: "espresso", substate: "pouring" } },
        scale: { timestamp: "2026-06-18T10:00:23.000Z", timerValue: 25000 }
      }
    ];

    render(<ShotGraph measurements={measurements} />);

    expect(getByTextContent("23s")).toBeInTheDocument();
    expect(queryByTextContent("25s")).not.toBeInTheDocument();
  });

  it("falls back to the active brew window when substates are not present", () => {
    const measurements: ShotSnapshot[] = [
      {
        machine: { timestamp: "2026-06-18T10:00:00.000Z", pressure: 0.2, flow: 0 },
        scale: { timestamp: "2026-06-18T10:00:00.000Z", weightFlow: 0 }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:01.000Z", pressure: 2, flow: 0.4 },
        scale: { timestamp: "2026-06-18T10:00:01.000Z", weightFlow: 0.3 }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:24.000Z", pressure: 7, flow: 1.2 },
        scale: { timestamp: "2026-06-18T10:00:24.000Z", weightFlow: 1.1 }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:32.600Z", pressure: 0.1, flow: 0 },
        scale: { timestamp: "2026-06-18T10:00:32.600Z", weightFlow: 0 }
      }
    ];

    render(<ShotGraph measurements={measurements} />);

    expect(getByTextContent("23s")).toBeInTheDocument();
    expect(queryByTextContent("32.6s")).not.toBeInTheDocument();
  });
});
