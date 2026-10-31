import skinManifest from "../../skin-manifest.json";

declare global {
  var __WORKFLOW_SKIN_ENABLE_TEST_LOGS__: boolean | undefined;
}

const SKIN_LOG_PREFIX = "[WorkFlow Skin]";

export function skinLog(event: string, details: Record<string, unknown> = {}) {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test" && !globalThis.__WORKFLOW_SKIN_ENABLE_TEST_LOGS__) return;

  try {
    console.log(
      `${SKIN_LOG_PREFIX} ${JSON.stringify({
        event,
        version: skinManifest.version,
        timestamp: new Date().toISOString(),
        ...details
      })}`
    );
  } catch {
    console.log(`${SKIN_LOG_PREFIX} ${event}`);
  }
}
