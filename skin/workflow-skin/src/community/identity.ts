import type { DecentAccountStatus } from "./types";

const exactEmailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/i;
const embeddedEmailPattern = /[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/i;

export function isEmailLike(value: string): boolean {
  return exactEmailPattern.test(value.trim());
}

function isPublicNameCandidate(value: string | undefined): value is string {
  const candidate = value?.trim();
  return Boolean(candidate && !isEmailLike(candidate) && !embeddedEmailPattern.test(candidate));
}

export function publicNameFromDecentAccount(account: DecentAccountStatus | null | undefined): string | null {
  if (!account?.connected) return null;

  const candidates = [account.displayName, account.username, account.name];
  const publicName = candidates.find(isPublicNameCandidate);
  return publicName?.trim() ?? null;
}
