import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveTelemetry } from "../state/useLiveTelemetry";

type Listener = (event: Event | MessageEvent) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.emit("close", new Event("close"));
  }

  emit(type: string, event: Event | MessageEvent) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

describe("useLiveTelemetry", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalUserAgent = navigator.userAgent;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "WorkFlow telemetry test" });
    Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: FakeWebSocket });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUserAgent });
    Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: originalWebSocket });
  });

  it("reopens stale sockets on foreground and clears the old pouring status until fresh state arrives", async () => {
    const { result } = renderHook(() => useLiveTelemetry("ws://machine"));
    const firstMachineSocket = FakeWebSocket.instances.find((socket) => socket.url.endsWith("/ws/v1/machine/snapshot"));
    expect(firstMachineSocket).toBeDefined();

    act(() => {
      firstMachineSocket?.emit("open", new Event("open"));
      firstMachineSocket?.emit(
        "message",
        new MessageEvent("message", { data: JSON.stringify({ state: { state: "espresso", substate: "pouring" } }) })
      );
    });
    expect(result.current.machineStreamConnected).toBe(true);
    expect(result.current.machineMode).toEqual({ state: "espresso", substate: "pouring" });

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(8));
    expect(result.current.machineStreamConnected).toBe(false);
    expect(result.current.machineMode).toBeNull();

    const secondMachineSocket = [...FakeWebSocket.instances]
      .reverse()
      .find((socket) => socket.url.endsWith("/ws/v1/machine/snapshot"));
    act(() => {
      secondMachineSocket?.emit("open", new Event("open"));
      secondMachineSocket?.emit(
        "message",
        new MessageEvent("message", { data: JSON.stringify({ state: { state: "idle", substate: "idle" } }) })
      );
    });

    expect(result.current.machineStreamConnected).toBe(true);
    expect(result.current.machineMode).toEqual({ state: "idle", substate: "idle" });
  });

  it("accepts a fresh connected status while requiring a reading to keep it live", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLiveTelemetry("ws://machine"));
    const scaleSocket = FakeWebSocket.instances.find((socket) => socket.url.endsWith("/ws/v1/scale/snapshot"));
    expect(result.current.scaleVerificationActive).toBe(true);

    act(() => {
      scaleSocket?.emit("message", new MessageEvent("message", { data: JSON.stringify({ status: "connected" }) }));
    });
    expect(result.current.scaleConnected).toBe(true);

    act(() => vi.advanceTimersByTime(5001));
    expect(result.current.scaleConnected).toBe(false);

    act(() => {
      scaleSocket?.emit("message", new MessageEvent("message", { data: JSON.stringify({ status: "connected" }) }));
      scaleSocket?.emit("message", new MessageEvent("message", { data: JSON.stringify({ weight: 0, battery: 72 }) }));
      vi.advanceTimersByTime(5001);
    });
    expect(result.current.scaleConnected).toBe(true);

    act(() => {
      scaleSocket?.emit("message", new MessageEvent("message", { data: JSON.stringify({ status: "disconnected" }) }));
    });
    expect(result.current.scaleConnected).toBe(false);
  });

  it("does not reset healthy live streams when the optional shot lifecycle socket is unavailable", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useLiveTelemetry("ws://machine"));
    const machineSocket = FakeWebSocket.instances.find((socket) => socket.url.endsWith("/ws/v1/machine/snapshot"));
    const shotSocket = FakeWebSocket.instances.find((socket) => socket.url.endsWith("/ws/v1/machine/shotState"));

    act(() => {
      machineSocket?.emit("open", new Event("open"));
      machineSocket?.emit(
        "message",
        new MessageEvent("message", { data: JSON.stringify({ state: { state: "espresso", substate: "pouring" } }) })
      );
      shotSocket?.emit("close", new Event("close"));
      vi.advanceTimersByTime(1001);
    });

    expect(FakeWebSocket.instances).toHaveLength(4);
    expect(result.current.machineStreamConnected).toBe(true);
    expect(result.current.machineMode).toEqual({ state: "espresso", substate: "pouring" });
  });
});
