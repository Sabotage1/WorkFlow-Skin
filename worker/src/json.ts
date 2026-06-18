const defaultCorsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400"
};

export class JsonBodyError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
    this.name = "JsonBodyError";
  }
}

export function corsHeaders(): HeadersInit {
  return { ...defaultCorsHeaders };
}

export function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(defaultCorsHeaders)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(value), {
    ...init,
    headers
  });
}

export function errorResponse(message: string, status: number): Response {
  const error = status === 403 ? "forbidden" : status === 404 ? "not_found" : status >= 500 ? "server_error" : "bad_request";
  return jsonResponse({ error, message }, { status });
}

export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new JsonBodyError("Request body is too large.", 413);
    }
  }

  const bytes = await readCappedBody(request, maxBytes);

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new JsonBodyError("Request body must be valid JSON.");
  }
}

async function readCappedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const result = await reader.read();
    if (result.done) break;

    const chunk = result.value;
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel("Request body is too large.");
      } catch {
        // Preserve the 413 response even if the stream source rejects cancellation.
      }
      throw new JsonBodyError("Request body is too large.", 413);
    }
    chunks.push(chunk);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
