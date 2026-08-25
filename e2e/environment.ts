const defaultPort = 3100;

export interface E2EAdminAccount {
  email: string;
  password: string;
}

export interface E2ETestEnvironment {
  admin?: E2EAdminAccount | undefined;
  inventory?: E2EAdminAccount | undefined;
  sales?: E2EAdminAccount | undefined;
  baseURL: string;
  externalServer: boolean;
  port: number;
}

/**
 * Reads optional seeded-admin credentials. When both are present the
 * authenticated Playwright flows run against the provisioned identity;
 * otherwise those tests skip so the suite stays green on fresh checkouts.
 */
function readAdminAccount(
  email: string | undefined,
  password: string | undefined,
): E2EAdminAccount | undefined {
  if ((email === undefined) !== (password === undefined)) {
    throw new Error(
      "Set both E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to exercise authenticated flows.",
    );
  }

  if (
    email === undefined ||
    password === undefined ||
    email === "" ||
    password === ""
  ) {
    return undefined;
  }

  return { email, password };
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
    admin: readAdminAccount(
      environment.E2E_ADMIN_EMAIL,
      environment.E2E_ADMIN_PASSWORD,
    ),
    sales: readAdminAccount(
      environment.E2E_SALES_EMAIL,
      environment.E2E_SALES_PASSWORD,
    ),
    inventory: readAdminAccount(
      environment.E2E_INVENTORY_EMAIL,
      environment.E2E_INVENTORY_PASSWORD,
    ),
    baseURL: externalBaseURL ?? `http://127.0.0.1:${String(port)}`,
    externalServer: externalBaseURL !== undefined,
    port,
  };
}
