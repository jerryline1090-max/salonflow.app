// Test-only identity gate. Never import into application runtime.
const DISPOSABLE_REF = "dalajmwkjxaatsxvsgov";
const PRODUCTION_REF = "hnetmmshkcnpobtcjotz";
type Environment = Record<string, string | undefined>;

export function postgresHarnessUrl(env: Environment): string | undefined {
  if (env.NODE_ENV !== "test" || env.RUN_APPOINTMENT_POSTGRES_TESTS !== "approved-disposable" || !env.TEST_DATABASE_URL) return undefined;
  try {
    const url = new URL(env.TEST_DATABASE_URL);
    const username = decodeURIComponent(url.username);
    const project = username.split(".");
    const direct = url.hostname === `db.${DISPOSABLE_REF}.supabase.co`;
    const pooler = url.hostname === "aws-1-eu-west-1.pooler.supabase.com" &&
      project.length === 2 && project[0].length > 0 && project[1] === DISPOSABLE_REF;
    const limit = url.searchParams.get("connection_limit");
    if (url.hostname.includes(PRODUCTION_REF) || username.includes(PRODUCTION_REF) ||
        !["postgres:", "postgresql:"].includes(url.protocol) || !(direct || pooler) ||
        url.port !== "5432" || url.searchParams.getAll("sslmode").length !== 1 ||
        url.searchParams.get("sslmode") !== "require" ||
        url.searchParams.getAll("connection_limit").length > 1 ||
        (limit !== null && (!/^\d+$/.test(limit) || !Number.isSafeInteger(Number(limit)) || Number(limit) < 2))) {
      throw new Error();
    }
    return env.TEST_DATABASE_URL;
  } catch {
    // URL parser errors can contain credentials; never propagate them.
    throw new Error("Disposable PostgreSQL harness identity guard rejected configuration");
  }
}

export function initializePostgresHarness<T>(env: Environment, create: (url: string) => T): T | undefined {
  const url = postgresHarnessUrl(env);
  return url === undefined ? undefined : create(url);
}
