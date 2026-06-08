import { Effect } from "effect";
import type { StatusCode } from "node-opcua";

import { isGood } from "./normalize.js";

export type StatusDecodeResultInput<Value, Status, Output> = {
  readonly statusCode: StatusCode;
  readonly status: Status;
  readonly decode: Effect.Effect<Value, unknown>;
  readonly value: (decoded: Value) => Output;
  readonly nonGoodStatus: (status: Status) => Output;
  readonly decodeError: (error: unknown, status: Status) => Output;
};

export const resultFromStatusAndDecode = <Value, Status, Output>(
  input: StatusDecodeResultInput<Value, Status, Output>,
): Effect.Effect<Output> => {
  if (!isGood(input.statusCode)) {
    return Effect.succeed(input.nonGoodStatus(input.status));
  }
  return Effect.match(input.decode, {
    onFailure: (error) => input.decodeError(error, input.status),
    onSuccess: input.value,
  });
};
