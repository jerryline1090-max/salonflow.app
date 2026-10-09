import { initializePostgresHarness, postgresHarnessUrl } from "./postgresHarnessGuard";

// Synthetic URL components only: no password or real connection string.
const disposable = "dalajmwkjxaatsxvsgov";
const production = "hnetmmshkcnpobtcjotz";
const another = "abcdefghijklmnopqrst";
function connection(ref = disposable, direct = false) {
  const url = new URL("postgresql://fixture.invalid");
  url.hostname = direct ? `db.${ref}.supabase.co` : "aws-1-eu-west-1.pooler.supabase.com";
  url.username = direct ? "fixture" : `fixture.${ref}`;
  url.port = "5432";
  url.searchParams.set("sslmode", "require");
  return url.toString();
}
const enabled = () => ({ NODE_ENV: "test", RUN_APPOINTMENT_POSTGRES_TESTS: "approved-disposable", TEST_DATABASE_URL: connection() });

describe("disposable PostgreSQL harness safety (no database)", () => {
  it.each([
    ["no opt-in", { RUN_APPOINTMENT_POSTGRES_TESTS: undefined }],
    ["wrong opt-in", { RUN_APPOINTMENT_POSTGRES_TESTS: "true" }],
    ["production environment", { NODE_ENV: "production" }],
    ["development environment", { NODE_ENV: "development" }],
    ["missing test URL", { TEST_DATABASE_URL: undefined }],
    ["runtime URL alone", { TEST_DATABASE_URL: undefined, DATABASE_URL: connection() }],
  ])("skips before initialization: %s", (_name, overrides) => {
    const create = jest.fn();
    expect(initializePostgresHarness({ ...enabled(), ...overrides }, create)).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
  it.each([
    ["production pooler", connection(production)],
    ["production direct", connection(production, true)],
    ["other pooler project", connection(another)],
    ["other direct project", connection(another, true)],
    ["generic pooler username", connection().replace(`fixture.${disposable}`, "fixture")],
    ["wrong pooler host", connection().replace("aws-1-eu-west-1", "aws-9-us-west-1")],
    ["transaction pooler port", connection().replace("5432", "6543")],
    ["missing TLS", connection().replace("require", "disable")],
    ["one connection", connection() + "&connection_limit=1"],
    ["invalid connection limit", connection() + "&connection_limit=NaN"],
    ["malformed URL", "not a URL"],
  ])("rejects before Prisma initialization: %s", (_name, url) => {
    const create = jest.fn();
    expect(() => initializePostgresHarness({ ...enabled(), TEST_DATABASE_URL: url }, create)).toThrow("Disposable PostgreSQL harness identity guard rejected configuration");
    expect(create).not.toHaveBeenCalled();
  });
  it.each([disposable, production, another])("operator reference cannot override fixed identity: %s", ref => {
    expect(() => postgresHarnessUrl({ ...enabled(), TEST_DATABASE_URL: connection(production), APPROVED_DISPOSABLE_PROJECT_REF: ref })).toThrow();
  });
  it.each([false, true])("accepts exact disposable identity, direct=%s", direct => {
    const url = connection(disposable, direct);
    const create = jest.fn(() => "test-client");
    expect(initializePostgresHarness({ ...enabled(), TEST_DATABASE_URL: url, DATABASE_URL: connection(production) }, create)).toBe("test-client");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(url);
  });
  it("accepts multiple connections and sanitizes parse errors", () => {
    expect(postgresHarnessUrl({ ...enabled(), TEST_DATABASE_URL: connection() + "&connection_limit=2" })).toBeDefined();
    expect(() => postgresHarnessUrl({ ...enabled(), TEST_DATABASE_URL: "private-invalid-value" })).toThrow(/^Disposable PostgreSQL harness identity guard rejected configuration$/);
  });
});
