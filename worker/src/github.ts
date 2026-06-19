export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
  sha?: string;
}

export interface GitHubJsonClient {
  readJson<T>(path: string, fallback: T): Promise<T>;
  readJsonWithSha<T>(path: string, fallback: T): Promise<{ value: T; sha?: string }>;
  writeJson(path: string, value: unknown, message: string): Promise<void>;
  writeJsonWithSha(path: string, value: unknown, message: string, expectedSha?: string): Promise<void>;
  deleteJson(path: string, message: string): Promise<void>;
}

export class GitHubWriteConflictError extends Error {
  constructor(readonly path: string, readonly status: number, message: string) {
    super(message);
    this.name = "GitHubWriteConflictError";
  }
}

function encodePath(path: string): string {
  validateContentPath(path);
  return path.split("/").map(encodeURIComponent).join("/");
}

function validateContentPath(path: string): void {
  const segments = path.split("/");
  if (path.includes("\\") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid GitHub content path: ${path}`);
  }
  if (!isManagedCommunityContentPath(path)) {
    throw new Error(`GitHub content path is outside managed community profile data: ${path}`);
  }
}

export function isManagedCommunityContentPath(path: string): boolean {
  const segments = path.split("/");
  if (path.includes("\\") || segments.some((segment) => !segment || segment === "." || segment === "..")) return false;
  return (
    path === "Profiles/index.json" ||
    path.startsWith("Profiles/recommendations/") ||
    path.startsWith("Profiles/profiles/") ||
    path.startsWith("Profiles/evidence/") ||
    path.startsWith("Profiles/history/") ||
    path.startsWith("Profiles/ratings/")
  );
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubError(response: Response, action: string, path: string): Promise<Error> {
  const body = await response.text();
  return new Error(`GitHub ${action} failed for ${path}: ${response.status} ${body.slice(0, 300)}`);
}

export class GitHubContentsClient implements GitHubJsonClient {
  constructor(private readonly config: GitHubConfig) {}

  private headers(): HeadersInit {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${this.config.token}`,
      "content-type": "application/json",
      "user-agent": "workflow-skin-community-worker",
      "x-github-api-version": "2026-03-10"
    };
  }

  private url(path: string): string {
    return `https://api.github.com/repos/${encodeURIComponent(this.config.owner)}/${encodeURIComponent(this.config.repo)}/contents/${encodePath(path)}`;
  }

  private async getContent(path: string): Promise<GitHubContentResponse | null> {
    const response = await fetch(`${this.url(path)}?ref=${encodeURIComponent(this.config.branch)}`, {
      method: "GET",
      headers: this.headers()
    });

    if (response.status === 404) return null;
    if (!response.ok) throw await githubError(response, "read", path);
    return (await response.json()) as GitHubContentResponse;
  }

  async readJson<T>(path: string, fallback: T): Promise<T> {
    return (await this.readJsonWithSha(path, fallback)).value;
  }

  async readJsonWithSha<T>(path: string, fallback: T): Promise<{ value: T; sha?: string }> {
    const content = await this.getContent(path);
    if (!content?.content) return { value: fallback };
    return {
      value: JSON.parse(decodeBase64(content.content)) as T,
      sha: content.sha
    };
  }

  async writeJson(path: string, value: unknown, message: string): Promise<void> {
    const existing = await this.getContent(path);
    return this.writeJsonWithSha(path, value, message, existing?.sha);
  }

  async writeJsonWithSha(path: string, value: unknown, message: string, expectedSha?: string): Promise<void> {
    const body: Record<string, unknown> = {
      message,
      branch: this.config.branch,
      content: encodeBase64(`${JSON.stringify(value, null, 2)}\n`)
    };
    if (expectedSha) body.sha = expectedSha;

    const response = await fetch(this.url(path), {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body)
    });

    if (response.status === 409 || response.status === 422) {
      throw new GitHubWriteConflictError(path, response.status, `GitHub write conflict for ${path}.`);
    }
    if (!response.ok) throw await githubError(response, "write", path);
  }

  async deleteJson(path: string, message: string): Promise<void> {
    const existing = await this.getContent(path);
    if (!existing?.sha) return;

    const response = await fetch(this.url(path), {
      method: "DELETE",
      headers: this.headers(),
      body: JSON.stringify({
        message,
        branch: this.config.branch,
        sha: existing.sha
      })
    });

    if (response.status === 409 || response.status === 422) {
      throw new GitHubWriteConflictError(path, response.status, `GitHub delete conflict for ${path}.`);
    }
    if (!response.ok) throw await githubError(response, "delete", path);
  }
}

export function githubFromEnv(env: Env): GitHubJsonClient {
  return new GitHubContentsClient({
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH,
    token: env.GITHUB_TOKEN
  });
}
