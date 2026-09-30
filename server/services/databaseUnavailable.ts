export class DatabaseUnavailableError extends Error {
  readonly code = "DATABASE_UNAVAILABLE";

  constructor() {
    super("The database client is unavailable.");
    this.name = "DatabaseUnavailableError";
  }
}

/**
 * Keep the HTTP server available for non-database routes, but fail every
 * database operation explicitly instead of returning fabricated empty rows.
 */
export function createUnavailablePrisma(): any {
  const unavailableDelegate = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") return undefined;
        return async () => {
          throw new DatabaseUnavailableError();
        };
      },
    },
  );

  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "$disconnect") return async () => {};
        if (property === "$on") return () => {};
        if (property === "then") return undefined;
        if (
          property === "$connect" ||
          property === "$transaction" ||
          property === "$executeRawUnsafe" ||
          property === "$queryRaw" ||
          property === "$queryRawUnsafe"
        ) {
          return async () => {
            throw new DatabaseUnavailableError();
          };
        }
        return unavailableDelegate;
      },
    },
  );
}