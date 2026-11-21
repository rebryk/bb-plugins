import { z } from 'zod';
import type { BbPluginApi } from '@get-bb/plugin-sdk';

// Thread Sidebar owns every status decision, including CI and historical ETA.
export const sidebarPhaseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('running'), reason: z.string(), etaAt: z.number(), since: z.number() }),
  z.object({ kind: z.literal('needs-you'), reason: z.string() }),
  z.object({ kind: z.literal('failed'), reason: z.string() }),
  z.object({ kind: z.literal('done'), unread: z.boolean() }),
]);
export type SidebarPhase = z.infer<typeof sidebarPhaseSchema>;
const responseSchema = z.object({ phases: z.record(z.string(), sidebarPhaseSchema) });

export async function readSidebarPhases(bb: BbPluginApi, threadIds: string[]): Promise<Record<string, SidebarPhase>> {
  const ids = [...new Set(threadIds)];
  const phases: Record<string, SidebarPhase> = {};
  for (let start = 0; start < ids.length; start += 200) {
    const response = await bb.sdk.plugins.callRpc({
      pluginId: 'thread-sidebar', method: 'resolved_phases', input: { threadIds: ids.slice(start, start + 200) }, outputSchema: responseSchema,
    });
    Object.assign(phases, response.phases);
  }
  return phases;
}

export async function trackLegacyOutline(bb: BbPluginApi, threadId: string) {
  await bb.sdk.plugins.callRpc({ pluginId: 'thread-sidebar', method: 'track_outline',
    input: { threadId, enabled: true }, outputSchema: z.object({ tracked: z.boolean() }) });
}
