const defaultPort = 3100;

export interface E2ETestEnvironment {
  baseURL: string;
  externalServer: boolean;
  port: number;
}

function readPort(rawPort: string | undefined): number {
  if (rawPort === undefined) {
    return defaultPort;
  }

  if (!/^\d+$/.test(rawPort)) {
    throw new Error("PLAYWRIGHT_PORT must be an integer.");
  }

  const port = Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("PLAYWRIGHT_PORT must be between 1024 and 65535.");
  }

  return port;
}

function readExternalBaseURL(
  rawBaseURL: string | undefined,
): string | undefined {
  if (rawBaseURL === undefined) {
    return undefined;
  }

  const baseURL = URL.parse(rawBaseURL);

  if (
    baseURL === null ||
    !["http:", "https:"].includes(baseURL.protocol) ||
    baseURL.username !== "" ||
    baseURL.password !== "" ||
    baseURL.search !== "" ||
    baseURL.hash !== ""
  ) {
    throw new Error(
      "PLAYWRIGHT_BASE_URL must be an HTTP(S) URL without credentials, query parameters, or a fragment.",
    );
  }

  return baseURL.toString().replace(/\/$/, "");
}

export function readE2ETestEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): E2ETestEnvironment {
  const port = readPort(environment.PLAYWRIGHT_PORT);
  const externalBaseURL = readExternalBaseURL(environment.PLAYWRIGHT_BASE_URL);

  return {
    baseURL: externalBaseURL ?? `http://127.0.0.1:${String(port)}`,
    externalServer: externalBaseURL !== undefined,
    port,
  };
}
