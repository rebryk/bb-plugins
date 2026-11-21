import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export type AgentRole = "coordinator" | "task" | "worker";
export interface ModelPreference { providerId: string; model: string }
export interface ExecutionRequest {
  role: AgentRole;
  projectId: string;
  hostId?: string;
  environmentId?: string;
  preferences?: ModelPreference[];
  preferred?: ModelPreference & { reasoningLevel?: string };
}
export interface ExecutionChoice extends ModelPreference {
  reasoningLevel?: string;
  reason: string;
}

// Pool Usage normalizes pool and provider-native quotas and marks stale data
// offline. This read-only integration is optional; it never resets quota.
const usageSchema = z.object({
  providers: z.array(z.object({ id: z.string(), switchThreshold: z.number().min(0).max(1) })),
  accounts: z.array(z.object({
    provider: z.string(), weight: z.number().nonnegative(), disabled: z.boolean(),
    offline: z.string().nullable(), blocked: z.boolean(),
    windows: z.array(z.object({ utilization: z.number().min(0).max(1).nullable(), rejected: z.boolean() })),
  })),
});
export type Usage = z.infer<typeof usageSchema>;
export interface RoutingModel {
  model: string;
  displayName: string;
  isDefault: boolean;
  reasoningDiscovery?: "known" | "unknown";
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string }[];
  routeProviderId?: string;
}
export interface RoutingProvider { id: string; models: RoutingModel[] }

/** Unknown readings remain unknown, including partial account/window data. */
export function headroom(usage: Usage | null, providerId: string): number | null {
  if (!usage) return null;
  const accounts = usage.accounts.filter(a => a.provider === providerId && !a.disabled && a.weight > 0);
  if (!accounts.length) return null;
  const threshold = usage.providers.find(p => p.id === providerId)?.switchThreshold;
  if (threshold === undefined) return null;
  let available = 0, total = 0;
  for (const account of accounts) {
    total += account.weight;
    if (account.blocked || account.windows.some(w => w.rejected)) continue;
    if (account.offline || !account.windows.length || account.windows.some(w => w.utilization === null)) return null;
    const worst = Math.max(...account.windows.map(w => w.rejected ? 1 : w.utilization!));
    available += account.weight * (worst >= threshold ? 0 : 1 - worst);
  }
  return total ? available / total : null;
}

function modelOrder(a: RoutingModel, b: RoutingModel): number {
  // Prefer the current strongest advertised families; only actual catalog
  // entries are candidates. Explicit preferences override this default policy.
  const tier = (m: RoutingModel) => /astra|opus/i.test(m.model + " " + m.displayName) ? 0 : m.isDefault ? 1 : 2;
  return tier(a) - tier(b) || b.model.localeCompare(a.model, "en", { numeric: true });
}

export function selectExecution(providers: RoutingProvider[], usage: Usage | null, request: ExecutionRequest): ExecutionChoice {
  const candidates = providers.flatMap(provider => provider.models
    .filter(model => !model.routeProviderId || model.routeProviderId === provider.id)
    .map(model => ({ providerId: provider.id, model, capacity: headroom(usage, provider.id) })));
  const preferred = request.preferred;
  const eligible = candidates.filter(c => c.capacity !== 0 && (!preferred || c.providerId === preferred.providerId && c.model.model === preferred.model));
  if (!eligible.length) throw new Error(preferred
    ? "The selected model is unavailable or its provider has no reported capacity. Choose another model or wait."
    : "No available model has usable capacity. Wait for capacity or enable an available provider.");
  const preferenceIndex = (c: typeof eligible[number]) => {
    const i = request.preferences?.findIndex(p => p.providerId === c.providerId && p.model === c.model.model) ?? -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  eligible.sort((a, b) => {
    if (a.capacity !== null && b.capacity === null) return -1;
    if (a.capacity === null && b.capacity !== null) return 1;
    return (b.capacity ?? 0) - (a.capacity ?? 0) || preferenceIndex(a) - preferenceIndex(b)
      || providers.findIndex(p => p.id === a.providerId) - providers.findIndex(p => p.id === b.providerId)
      || modelOrder(a.model, b.model);
  });
  const chosen = eligible[0]!;
  const supported = chosen.model.reasoningDiscovery === "unknown" ? [] : chosen.model.supportedReasoningEfforts.map(e => e.reasoningEffort);
  if (preferred?.reasoningLevel && !supported.includes(preferred.reasoningLevel)) {
    throw new Error("The selected reasoning level is not supported by this model's catalog.");
  }
  const levels = request.role === "coordinator" ? ["medium", "high", "low"] : ["xhigh", "high", "max", "medium", "low"];
  const reasoningLevel = preferred?.reasoningLevel ?? levels.find(l => supported.includes(l))
    ?? (supported.includes(chosen.model.defaultReasoningEffort) ? chosen.model.defaultReasoningEffort : undefined);
  return {
    providerId: chosen.providerId, model: chosen.model.model,
    ...(reasoningLevel ? { reasoningLevel } : {}),
    reason: `${preferred ? "Explicit model" : "Capacity routing"}; ${chosen.capacity === null
      ? "capacity unknown, using stable catalog/preferences fallback"
      : `${Math.round(chosen.capacity * 100)}% reported quota headroom (provider-wide estimate, not execution speed)`}; ${reasoningLevel ?? "provider default effort"}.`,
  };
}

export async function chooseExecution(bb: BbPluginApi, request: ExecutionRequest): Promise<ExecutionChoice> {
  const routing = request.environmentId ? { environmentId: request.environmentId } : request.hostId ? { hostId: request.hostId } : {};
  const [available, usage] = await Promise.all([
    bb.sdk.providers.list(routing),
    bb.sdk.plugins.callRpc({ pluginId: "pool-usage", method: "usage_get", input: null, outputSchema: usageSchema }).catch(() => null),
  ]);
  const catalogs = await Promise.all(available.filter(p => p.available).map(async provider => {
    const modelScope = request.environmentId
      ? { environmentId: request.environmentId, providerId: provider.id }
      : { projectId: request.projectId, ...(request.hostId ? { hostId: request.hostId } : {}), providerId: provider.id };
    const result = await bb.sdk.providers.models(modelScope).catch(() => null);
    return { id: provider.id, models: result?.modelLoadError ? [] : result?.models ?? [] };
  }));
  return selectExecution(catalogs, usage, request);
}
