export interface FirmwareArtifact {
  id: string;
  build: number;
  versionLabel?: string;
  releaseNotes?: string;
  supportedModels?: string[];
  eligibility: { status: "applicable" | "notApplicable" | "unknown"; reasons: string[] };
}

export interface FirmwareCatalog {
  artifacts: FirmwareArtifact[];
  machine: { model: string; build: number | null } | null;
  recommendedArtifactId: string | null;
  updateAvailable: boolean | null;
  operation: { state: "idle" | "erasing" | "uploading" | "verifying" | "cancelling" };
}

export interface FirmwareProgressEvent {
  status: "erasing" | "uploading" | "done" | "error";
  progress: number;
  error?: string;
}

export interface AppUpdateState {
  phase: "idle" | "checking" | "available" | "downloading" | "installing" | "error";
  currentVersion: string;
  latestVersion?: string | null;
  releaseNotes?: string | null;
  releaseUrl: string;
  installable: boolean;
  progress?: number | null;
  error?: string | null;
}

// HTTP acceptance and 100% uploaded do not establish successful verification.
export async function readFirmwareProgress(response: Response, onProgress: (event: FirmwareProgressEvent) => void): Promise<void> {
  if (!response.body) throw new Error("Decaid did not return firmware update progress.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consume = (line: string): boolean => {
    if (!line.trim()) return false;
    if (line.length > 65536) throw new Error("Decaid returned invalid firmware update progress.");
    const event = JSON.parse(line) as FirmwareProgressEvent;
    if (!["erasing", "uploading", "done", "error"].includes(event.status) || !Number.isFinite(event.progress)) {
      throw new Error("Decaid returned invalid firmware update progress.");
    }
    if (event.status === "error") throw new Error(event.error || "The firmware update failed.");
    if (event.progress < 0 || event.progress > 1) throw new Error("Decaid returned invalid firmware update progress.");
    onProgress(event);
    return event.status === "done";
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (consume(line)) return;
      }
      if (buffer.length > 65536) throw new Error("Decaid returned invalid firmware update progress.");
      if (done) {
        if (buffer.trim() && consume(buffer)) return;
        throw new Error("The connection ended before Decaid confirmed the firmware update. Check the machine before retrying.");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
