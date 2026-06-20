export async function uploadShotToVisualizer(api: { baseUrl: string }, shot: unknown) {
  const shotId = shot && typeof shot === "object" && "id" in shot ? String((shot as { id: unknown }).id) : "";
  if (!shotId) throw new Error("Visualizer upload requires a shot id.");

  const response = await fetch(`${api.baseUrl}/api/v1/plugins/visualizer.reaplugin/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shotId })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Visualizer upload failed: ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}
