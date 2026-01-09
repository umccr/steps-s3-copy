type ThawParams = {
  glacierFlexibleRetrievalThawSpeed?: string;
  glacierDeepArchiveThawSpeed?: string;
  intelligentTieringArchiveThawSpeed?: string;
  intelligentTieringDeepArchiveThawSpeed?: string;
};

type Event = {
  invokeArguments?: {
    thawParams?: ThawParams;
    [k: string]: unknown;
  };
  invokeSettings?: Record<string, unknown>;
};

const FLEXIBLE_ALLOWED = new Set(["Bulk", "Standard", "Expedited"]);
const DEEP_ALLOWED = new Set(["Bulk", "Standard"]);

class InvalidThawParamsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidThawParamsError";
  }
}

function assertAllowed(
  fieldName: keyof ThawParams,
  value: string | undefined,
  allowed: Set<string>,
) {
  if (value === undefined) return;
  if (!allowed.has(value)) {
    throw new InvalidThawParamsError(
      `Invalid thaw params: ${String(fieldName)}="${value}". Allowed: ${[
        ...allowed,
      ].join("|")}`,
    );
  }
}

export const handler = async (event: Event) => {
  const thawParams = event.invokeArguments?.thawParams ?? {};

  assertAllowed(
    "glacierFlexibleRetrievalThawSpeed",
    thawParams.glacierFlexibleRetrievalThawSpeed,
    FLEXIBLE_ALLOWED,
  );
  assertAllowed(
    "intelligentTieringArchiveThawSpeed",
    thawParams.intelligentTieringArchiveThawSpeed,
    FLEXIBLE_ALLOWED,
  );

  assertAllowed(
    "glacierDeepArchiveThawSpeed",
    thawParams.glacierDeepArchiveThawSpeed,
    DEEP_ALLOWED,
  );
  assertAllowed(
    "intelligentTieringDeepArchiveThawSpeed",
    thawParams.intelligentTieringDeepArchiveThawSpeed,
    DEEP_ALLOWED,
  );

  // pass-through unchanged payload (keeps the workflow contract stable)
  return event;
};
