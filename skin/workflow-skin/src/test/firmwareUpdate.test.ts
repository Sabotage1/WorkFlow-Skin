import { afterEach, describe, expect, it, vi } from "vitest";
import { ReaPrimeApi } from "../api/reaprime";
import { readFirmwareProgress } from "../api/updateTypes";

function response(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    controller.close();
  } }));
}

afterEach(() => vi.restoreAllMocks());

describe("firmware update transport", () => {
  it("reads split NDJSON records and the final record without a newline", async () => {
    const progress = vi.fn();
    await readFirmwareProgress(response(['{"status":"era', 'sing","progress":0}\n{"status":"uploading","progress":1}\n', '{"status":"done","progress":1}']), progress);
    expect(progress.mock.calls.map(([event]) => event.status)).toEqual(["erasing", "uploading", "done"]);
  });

  it.each([
    ['{"status":"uploading","progress":1}\n', /before Decaid confirmed/],
    ['{"status":"error","progress":-1,"error":"Verification failed"}\n', /Verification failed/],
    ['{"status":"unexpected","progress":0}\n', /invalid firmware update progress/],
    ["", /before Decaid confirmed/]
  ])("does not report success for an incomplete or failed stream", async (body, error) => {
    await expect(readFirmwareProgress(response([String(body)]), vi.fn())).rejects.toThrow(error as RegExp);
  });

  it("sends managed firmware IDs without force, and raw bytes without JSON conversion", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => response(['{"status":"done","progress":1}\n']));
    const api = new ReaPrimeApi("http://tablet:8080");
    const signal = new AbortController().signal;
    await api.streamFirmwareUpdate({ artifactId: "de1-1358" }, vi.fn(), signal);
    expect(fetch).toHaveBeenLastCalledWith("http://tablet:8080/api/v1/machine/firmware/apply", expect.objectContaining({
      headers: { "Content-Type": "application/json" }, body: '{"artifactId":"de1-1358","force":false}', signal
    }));
    const file = new Blob([new Uint8Array([0, 255, 1])]);
    await api.streamFirmwareUpdate({ file }, vi.fn(), signal);
    expect(fetch).toHaveBeenLastCalledWith("http://tablet:8080/api/v1/machine/firmware", expect.objectContaining({
      headers: { "Content-Type": "application/octet-stream" }, body: file, signal
    }));
  });

  it("rejects failed admission and cancels through Decaid", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("busy", { status: 409 })).mockResolvedValueOnce(new Response('{"operation":{"state":"idle"}}'));
    const api = new ReaPrimeApi("https://tablet:8080");
    await expect(api.streamFirmwareUpdate({ artifactId: "de1-1358" }, vi.fn(), new AbortController().signal)).rejects.toMatchObject({ status: 409 });
    await api.cancelFirmwareUpdate();
    expect(fetch).toHaveBeenLastCalledWith("https://tablet:8080/api/v1/machine/firmware", expect.objectContaining({ method: "DELETE" }));
    expect(api.appUpdateSocketUrl()).toBe("wss://tablet:8080/ws/v1/update");
  });
});
