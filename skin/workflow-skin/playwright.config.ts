import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.WORKFLOW_E2E_PORT ?? 5173);

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } }
    }
  ]
});
