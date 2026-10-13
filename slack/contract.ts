// The RPC methods between BB windows and the server.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { stateSchema } from "./shared";

export const rpcContract = defineRpcContract({
  /** The latest state, for a window that just connected. */
  slackState: { input: z.null(), output: stateSchema },
});
