// The RPC methods between the page and the server.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Node, Snapshot } from "./shared";

const result = z.object({ freed: z.number(), failed: z.array(z.string()) });

export const rpcContract = defineRpcContract({
  storageSnapshot: { input: z.null(), output: z.custom<Snapshot>() },
  storageFolder: {
    input: z.object({ path: z.string().max(4096) }).strict(),
    output: z.object({ path: z.string(), node: z.custom<Node>() }).nullable(),
  },
  storageRescan: { input: z.null(), output: z.null() },
  storageOpenFullDiskAccess: { input: z.null(), output: z.null() },
  storageDelete: {
    input: z
      .object({ paths: z.array(z.string().max(4096)).min(1).max(1000) })
      .strict(),
    output: result,
  },
  storageClean: {
    input: z.object({ target: z.enum(["bb", "dev", "trash"]) }).strict(),
    output: result,
  },
});
