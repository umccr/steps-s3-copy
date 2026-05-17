/**
 * Invariant checks for lambda inputs.
 */

/**
 * Asserts that `value` is a string and narrows its type.
 */
export function assertInvokeArgumentString(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (typeof value !== "string") {
    throw new InvokeArgumentsInvariantError(
      `invokeArguments.${fieldName} must be a string after state machine defaulting, ${
        value === undefined ? "undefined" : typeof value
      }`,
    );
  }
}

export class InvokeArgumentsInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvokeArgumentsInvariantError";
  }
}
