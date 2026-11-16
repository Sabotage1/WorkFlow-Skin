import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaPrimeApi, ReaPrimeApiError } from "../api/reaprime";
import type { FirmwareCatalog, FirmwareProgressEvent } from "../api/updateTypes";
import { UpdatesPanel } from "../components/UpdatesPanel";
import { useSoftwareUpdates } from "../state/useSoftwareUpdates";

class UpdateSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instance: UpdateSocket;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  constructor() { UpdateSocket.instance = this; queueMicrotask(() => this.onopen?.()); }
  close() { this.readyState = 3; this.onclose?.(); }
  emit(value: unknown) { act(() => this.onmessage?.({ data: JSON.stringify(value) })); }
}

const app = { phase: "idle", currentVersion: "0.9.2", installable: false, releaseUrl: "https://github.com/decentespresso/decaid/releases" };
function fixture() {
  const catalog: FirmwareCatalog = {
    artifacts: [{ id: "de1-1358", build: 1358, versionLabel: "1358", releaseNotes: "Firmware improvements", eligibility: { status: "applicable", reasons: [] } }],
    machine: { model: "DE1Pro", build: 1352 }, recommendedArtifactId: "de1-1358", updateAvailable: true, operation: { state: "idle" }
  };
  const api = {
    getFirmwareCatalog: vi.fn().mockResolvedValue(catalog),
    getFirmwareMachineInfo: vi.fn().mockResolvedValue({ model: "DE1Pro", version: "1352" }),
    getAppUpdateState: vi.fn().mockResolvedValue(app), getAppInfo: vi.fn().mockResolvedValue({ version: "0.9.2" }),
    appUpdateSocketUrl: () => "ws://tablet:8080/ws/v1/update",
    getMachineState: vi.fn().mockResolvedValue({ connected: true, state: { state: "idle" } }),
    streamFirmwareUpdate: vi.fn().mockImplementation(async (_source, progress: (event: FirmwareProgressEvent) => void) => progress({ status: "done", progress: 1 })),
    cancelFirmwareUpdate: vi.fn().mockResolvedValue({ operation: { state: "idle" } })
  };
  return { api, catalog };
}

function Harness({ api, visible = true }: { api: object; visible?: boolean }) {
  const updates = useSoftwareUpdates(api as ReaPrimeApi);
  return <>{visible && <UpdatesPanel updates={updates} />}</>;
}

beforeEach(() => vi.stubGlobal("WebSocket", UpdateSocket));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function install() {
  await userEvent.click(await screen.findByRole("button", { name: "Install firmware 1358" }));
  await userEvent.click(screen.getByRole("button", { name: "Install update" }));
}

describe("software updates", () => {
  it("requires confirmation, validates current machine state, and reports verified completion", async () => {
    const { api } = fixture();
    render(<Harness api={api} />);
    expect(await screen.findByText("Build 1352")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Install firmware 1358" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("DE1Pro");
    expect(api.streamFirmwareUpdate).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(api.streamFirmwareUpdate).not.toHaveBeenCalled();
    await install();
    expect(await screen.findByText("Firmware update verified and complete.")).toBeInTheDocument();
    expect(api.streamFirmwareUpdate).toHaveBeenCalledWith({ artifactId: "de1-1358" }, expect.any(Function), expect.any(AbortSignal));
  });

  it("waits for verification at 100%, retains the update across navigation, and cancels at the host", async () => {
    const { api } = fixture();
    let finish!: () => void;
    api.streamFirmwareUpdate.mockImplementationOnce((_source, progress) => new Promise<void>((resolve, reject) => {
      progress({ status: "uploading", progress: 1 });
      finish = () => reject(new Error("Firmware update cancelled"));
    }));
    const { rerender } = render(<Harness api={api} />);
    await install();
    expect(await screen.findByText("Verifying firmware on the machine…")).toBeInTheDocument();
    expect(screen.queryByText("Firmware update verified and complete.")).not.toBeInTheDocument();
    rerender(<Harness api={api} visible={false} />);
    rerender(<Harness api={api} />);
    expect(screen.getByText("Verifying firmware on the machine…")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel firmware update" }));
    expect(api.cancelFirmwareUpdate).toHaveBeenCalledOnce();
    await act(async () => finish());
    expect(await screen.findByText("Firmware update cancelled.")).toBeInTheDocument();
  });

  it.each(["espresso", "steam", "hotWater", "fwUpgrade"])("does not flash while the machine is %s", async (mode) => {
    const { api } = fixture();
    api.getMachineState.mockResolvedValue({ connected: true, state: { state: mode } });
    render(<Harness api={api} />);
    await install();
    expect(await screen.findByRole("alert")).toHaveTextContent("wait until it is idle or asleep");
    expect(api.streamFirmwareUpdate).not.toHaveBeenCalled();
  });

  it("handles older Decaid without claiming firmware is current and supports manual files", async () => {
    const { api } = fixture();
    api.getFirmwareCatalog.mockRejectedValue(new ReaPrimeApiError("missing", 404));
    render(<Harness api={api} />);
    expect(await screen.findByText("This Decaid version does not support this update feature.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install firmware 1358" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Upload a firmware file"));
    const file = new File([new Uint8Array([1, 2, 255])], "DE1.bin");
    await userEvent.upload(screen.getByLabelText("Firmware file"), file);
    await userEvent.click(screen.getByRole("button", { name: "Upload firmware" }));
    await userEvent.click(screen.getByRole("button", { name: "Install update" }));
    await waitFor(() => expect(api.streamFirmwareUpdate).toHaveBeenCalledWith({ file }, expect.any(Function), expect.any(AbortSignal)));
  });

  it("rejects an empty manual firmware file", async () => {
    const { api } = fixture(); render(<Harness api={api} />);
    await userEvent.click(await screen.findByText("Upload a firmware file"));
    fireEvent.change(screen.getByLabelText("Firmware file"), { target: { files: [new File([], "empty.bin")] } });
    expect(screen.getByRole("alert")).toHaveTextContent("non-empty firmware file");
    expect(screen.getByRole("button", { name: "Upload firmware" })).toBeDisabled();
  });

  it("does not turn model incompatibility or unknown eligibility into up to date", async () => {
    const { api, catalog } = fixture();
    catalog.recommendedArtifactId = null; catalog.updateAvailable = false;
    catalog.artifacts[0].eligibility = { status: "notApplicable", reasons: ["model_incompatible"] };
    render(<Harness api={api} />);
    expect(await screen.findByText("No compatible firmware available for this machine")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install firmware 1358" })).not.toBeInTheDocument();
  });

  it("checks Decaid over WebSocket and offers a release link on platforms without installation", async () => {
    const { api } = fixture(); render(<Harness api={api} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check for Decaid updates" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Check for Decaid updates" }));
    expect(UpdateSocket.instance.send).toHaveBeenLastCalledWith('{"command":"check"}');
    UpdateSocket.instance.emit({ ...app, phase: "checking" });
    UpdateSocket.instance.emit({ ...app, phase: "available", latestVersion: "0.9.3" });
    expect(screen.getByText("Decaid 0.9.3 is available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update Decaid" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Decaid releases" })).toHaveAttribute("href", app.releaseUrl);
  });

  it("requests an app installation only after confirmation and handles command rejection", async () => {
    const { api } = fixture();
    const available = { ...app, phase: "available", latestVersion: "0.9.3", installable: true };
    api.getAppUpdateState.mockResolvedValue(available);
    render(<Harness api={api} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Update Decaid" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Update Decaid" }));
    expect(UpdateSocket.instance.send).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Install update" }));
    await waitFor(() => expect(UpdateSocket.instance.send).toHaveBeenCalledWith('{"command":"install"}'));
    UpdateSocket.instance.emit({ error: "In-app install is not supported on this platform", url: app.releaseUrl });
    expect(screen.getByRole("alert")).toHaveTextContent("In-app install is not supported");
  });

  it("does not overwrite a newer live app update with an older REST snapshot", async () => {
    const { api } = fixture();
    let finish!: (value: typeof app) => void;
    api.getAppUpdateState.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<Harness api={api} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check for Decaid updates" })).toBeEnabled());
    UpdateSocket.instance.emit({ ...app, phase: "available", latestVersion: "0.9.3" });
    await act(async () => finish(app));
    expect(screen.getByText("Decaid 0.9.3 is available")).toBeInTheDocument();
  });

  it("revalidates firmware eligibility before starting and refuses changed eligibility", async () => {
    const { api, catalog } = fixture();
    render(<Harness api={api} />);
    await userEvent.click(await screen.findByRole("button", { name: "Install firmware 1358" }));
    api.getFirmwareCatalog.mockResolvedValue({ ...catalog, artifacts: [{ ...catalog.artifacts[0], eligibility: { status: "notApplicable", reasons: ["not_newer"] } }] });
    await userEvent.click(screen.getByRole("button", { name: "Install update" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer available");
    expect(api.streamFirmwareUpdate).not.toHaveBeenCalled();
  });

  it("does not offer raw DE1 firmware upload on Bengle", async () => {
    const { api, catalog } = fixture();
    catalog.machine = { model: "Bengle", build: 1352 }; catalog.recommendedArtifactId = null;
    api.getFirmwareMachineInfo.mockResolvedValue({ model: "Bengle", version: "1352" });
    render(<Harness api={api} />);
    await userEvent.click(await screen.findByText("Upload a firmware file"));
    expect(screen.getByLabelText("Firmware file")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Upload firmware" })).toBeDisabled();
  });

  it("keeps an unknown installed build distinct from up to date", async () => {
    const { api, catalog } = fixture();
    catalog.machine = { model: "DE1Pro", build: null }; catalog.recommendedArtifactId = null; catalog.updateAvailable = null;
    catalog.artifacts[0].eligibility = { status: "unknown", reasons: ["installed_build_unknown"] };
    render(<Harness api={api} />);
    expect(await screen.findByText("Could not determine firmware availability")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install firmware 1358" })).not.toBeInTheDocument();
  });

  it("can refresh after Decaid disconnects during app installation", async () => {
    const { api } = fixture(); render(<Harness api={api} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Check for Decaid updates" })).toBeEnabled());
    UpdateSocket.instance.emit({ ...app, phase: "installing" });
    act(() => UpdateSocket.instance.close());
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Check for Decaid updates" })).toBeEnabled());
  });
});
