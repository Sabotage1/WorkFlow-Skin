import type { CommunityDownloadPayload, CommunityIndex, CommunityRecommendation, CommunityShotEvidence } from "../community/types";
import type { Profile } from "./types";

export interface CommunityWritePayload {
  ownerKey: string;
  recommendation: Omit<CommunityRecommendation, "id" | "createdAt" | "updatedAt" | "searchText">;
  profileJson: Profile;
  evidence?: CommunityShotEvidence;
}

export interface CommunityDeletePayload {
  ownerKey: string;
}

export interface CommunityRatePayload {
  ownerKey: string;
  rating: number;
}

export class CommunityApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "CommunityApiError";
  }
}

export class CommunityApi {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}${path}`, {
      ...init,
      method,
      headers
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text;
      try {
        const payload = JSON.parse(text) as { error?: unknown; message?: unknown };
        if (typeof payload.message === "string") {
          message = payload.message;
        } else if (typeof payload.error === "string") {
          message = payload.error;
        }
      } catch {
        message = text;
      }
      throw new CommunityApiError(`${method} ${path} failed: ${response.status} ${message}`, response.status);
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  listRecommendations() {
    return this.request<CommunityIndex>("/api/recommendations");
  }

  getRecommendation(id: string) {
    return this.request<CommunityRecommendation>(`/api/recommendations/${encodeURIComponent(id)}`);
  }

  download(id: string) {
    return this.request<CommunityDownloadPayload>(`/api/download/${encodeURIComponent(id)}`);
  }

  create(payload: CommunityWritePayload) {
    return this.request<{ recommendation: CommunityRecommendation; index: CommunityIndex }>("/api/recommendations", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  update(id: string, payload: CommunityWritePayload) {
    return this.request<{ recommendation: CommunityRecommendation; index: CommunityIndex }>(`/api/recommendations/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  delete(id: string, payload: CommunityDeletePayload) {
    return this.request<{ id: string; index: CommunityIndex }>(`/api/recommendations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify(payload)
    });
  }

  rate(id: string, payload: CommunityRatePayload) {
    return this.request<{ recommendation: CommunityRecommendation; index: CommunityIndex; rating: number }>(`/api/recommendations/${encodeURIComponent(id)}/rating`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
}
