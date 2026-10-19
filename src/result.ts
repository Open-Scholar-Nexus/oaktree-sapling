/** The result envelope every verb returns: the `status` the workflows read. */

/** What a verb returns: the process exit code and the JSON `oak` prints with `--json`. */
export interface Outcome {
  exitCode: number;
  result: Record<string, unknown>;
}

/** A success: exit code 0 and `status: 'ok'`. */
export const ok = (fields: Record<string, unknown>): Outcome => ({
  exitCode: 0,
  result: { status: 'ok', ...fields },
});

/** A failure: the given exit code and `status: 'error'` with `message`. */
export const err = (
  exitCode: number,
  message: string,
  fields: Record<string, unknown> = {},
): Outcome => ({
  exitCode,
  result: { status: 'error', message, ...fields },
});
