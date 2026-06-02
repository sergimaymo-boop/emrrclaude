export type RuntimeEnv = Record<string, string | undefined>;

export interface ServerlessRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

export interface ServerlessResponse {
  status(statusCode: number): {
    json(body: unknown): void;
  };
}

export function getRuntimeEnv(): RuntimeEnv {
  const runtime = globalThis as unknown as {
    process?: { env?: RuntimeEnv };
  };

  return runtime.process?.env ?? {};
}

export function getEnvironment(env: RuntimeEnv = getRuntimeEnv()) {
  return env.VITE_APP_ENV ?? env.NODE_ENV ?? "production";
}

export function isRealApiEnabled(env: RuntimeEnv = getRuntimeEnv()) {
  return env.ENABLE_REAL_API_CALLS === "true";
}

export function isConfiguredSecret(value: string | undefined) {
  if (!value?.trim()) return false;

  const normalized = value.trim().toLowerCase();
  return !(
    normalized.includes("your_") ||
    normalized.includes("_here") ||
    normalized.includes("placeholder")
  );
}

export function getProviderState(apiKey: string | undefined) {
  return isConfiguredSecret(apiKey) ? "configured" : "not_configured";
}
