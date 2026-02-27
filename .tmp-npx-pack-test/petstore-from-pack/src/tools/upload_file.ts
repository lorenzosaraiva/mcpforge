export interface ToolHandlerContext {
  baseUrl: string;
  authHeaders: Record<string, string>;
}

const PATH_PARAMS = [
  {
    "name": "petId",
    "token": "{petId}"
  }
] as Array<{ name: string; token: string }>;
const QUERY_PARAMS = [
  {
    "name": "additionalMetadata",
    "required": false
  }
] as Array<{ name: string; required: boolean }>;
const HEADER_PARAMS = [] as Array<{ name: string; required: boolean }>;

function buildUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  const basePath = base.pathname.endsWith("/") ? base.pathname.slice(0, -1) : base.pathname;
  const requestPath = path.startsWith("/") ? path.slice(1) : path;
  const joinedPath = `${basePath}/${requestPath}`.replace(/\/{2,}/g, "/");
  base.pathname = joinedPath.startsWith("/") ? joinedPath : `/${joinedPath}`;
  return base;
}

export async function handleUploadFile(
  input: Record<string, unknown>,
  context: ToolHandlerContext,
): Promise<unknown> {
  let resolvedPath = "/pet/{petId}/uploadImage";

  for (const param of PATH_PARAMS) {
    const value = input[param.name];
    if (value === undefined || value === null) {
      throw new Error(`Missing required path parameter: ${param.name}`);
    }
    resolvedPath = resolvedPath.split(param.token).join(encodeURIComponent(String(value)));
  }

  const url = buildUrl(context.baseUrl, resolvedPath);

  for (const param of QUERY_PARAMS) {
    const value = input[param.name];
    if (value === undefined || value === null) {
      if (param.required) {
        throw new Error(`Missing required query parameter: ${param.name}`);
      }
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(param.name, String(item));
      }
    } else {
      url.searchParams.append(param.name, String(value));
    }
  }

  const headers: Record<string, string> = { ...context.authHeaders };

  for (const param of HEADER_PARAMS) {
    const value = input[param.name];
    if (value === undefined || value === null) {
      if (param.required) {
        throw new Error(`Missing required header parameter: ${param.name}`);
      }
      continue;
    }
    headers[param.name] = String(value);
  }

  const requestContentType = "application/octet-stream";
  const bodyInput = input.body;
  let requestBody: BodyInit | undefined;
  if (bodyInput !== undefined && bodyInput !== null) {
    headers["Content-Type"] = requestContentType;
    if (requestContentType.toLowerCase().includes("json")) {
      requestBody = JSON.stringify(bodyInput);
    } else if (
      typeof bodyInput === "string" ||
      bodyInput instanceof ArrayBuffer ||
      ArrayBuffer.isView(bodyInput) ||
      bodyInput instanceof Blob
    ) {
      requestBody = bodyInput as BodyInit;
    } else {
      requestBody = JSON.stringify(bodyInput);
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: requestBody,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown network failure";
    throw new Error(
      `Network request failed for POST ${url.toString()}: ${message}`,
    );
  }

  const responseContentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  let parsedBody: unknown = null;

  try {
    if (responseContentType.includes("application/json")) {
      parsedBody = await response.json();
    } else {
      parsedBody = await response.text();
    }
  } catch {
    parsedBody = await response.text();
  }

  if (!response.ok) {
    const bodyText = typeof parsedBody === "string" ? parsedBody : JSON.stringify(parsedBody, null, 2);
    throw new Error(
      `API request failed for POST ${url.toString()} (${response.status} ${response.statusText}): ${bodyText}`,
    );
  }

  return {
    status: response.status,
    data: parsedBody,
  };
}
