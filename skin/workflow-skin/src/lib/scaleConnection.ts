import type { DeviceInfo } from "../api/types";

export function usesNativeScaleRecovery(version: string | undefined): boolean {
  const match = version?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 0 || minor > 8 || (minor === 8 && patch >= 8);
}

export function supportsEarlyScaleReconnect(version: string | undefined): boolean {
  const match = version?.match(/(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/);
  if (!match) return false;
  const [, major, minor, patch, prerelease] = match;
  if (Number(major) > 0 || Number(minor) > 9 || (Number(minor) === 9 && Number(patch) > 0)) return true;
  if (Number(minor) !== 9) return false;
  return !prerelease || /^beta\.(\d+)$/.test(prerelease) && Number(prerelease.split(".")[1]) >= 2;
}

export function isPrimaryScaleCandidate(device: DeviceInfo): boolean {
  // Auxiliary scales belong to plugins or another workflow. Never promote one
  // into the espresso scale slot or use it as proof of a primary connection.
  if (device.connectionRole === "auxiliary" || device.type === "grinder") return false;
  if (device.type === "scale") return true;
  const label = `${device.name ?? ""} ${device.id}`.toLowerCase();
  if (label.includes("difluid") && label.includes("r2")) return false;
  return /scale|microbalance|acaia|hiroia|lunar|pearl|felicita|bookoo|boo koo/.test(label);
}
