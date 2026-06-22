import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ShotSnapshot } from "../api/types";
import { ShotGraph } from "../components/ShotGraph";

describe("ShotGraph", () => {
  it("uses scale timer values for the x-axis when timestamps include post-shot samples", () => {
    const measurements: ShotSnapshot[] = [
      {
        machine: { timestamp: "2026-06-18T10:00:00.000Z", pressure: 1 },
        scale: { timestamp: "2026-06-18T10:00:00.000Z", timerValue: 0 }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:11.000Z", pressure: 8 },
        scale: { timestamp: "2026-06-18T10:00:11.000Z", timerValue: 11000 }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:25.000Z", pressure: 1 },
        scale: { timestamp: "2026-06-18T10:00:25.000Z", timerValue: 11000 }
      }
    ];

    render(<ShotGraph measurements={measurements} />);

    expect(screen.getByText("11s")).toBeInTheDocument();
    expect(screen.queryByText("25s")).not.toBeInTheDocument();
  });

  it("falls back to machine timestamps when the scale timer stops while brew data continues", () => {
    const measurements: ShotSnapshot[] = [
      {
        machine: { timestamp: "2026-06-18T10:00:00.000Z", pressure: 1, flow: 0.1 },
        scale: { timestamp: "2026-06-18T10:00:00.000Z", timerValue: 0 }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:08.600Z", pressure: 8, flow: 1.4 },
        scale: { timestamp: "2026-06-18T10:00:08.600Z", timerValue: 8600 }
      },
      {
        machine: { timestamp: "2026-06-18T10:00:18.000Z", pressure: 7, flow: 1.2 },
        scale: { timestamp: "2026-06-18T10:00:18.000Z", timerValue: 8600 }
      }
    ];

    render(<ShotGraph measurements={measurements} />);

    expect(screen.getByText("18s")).toBeInTheDocument();
  });
});
