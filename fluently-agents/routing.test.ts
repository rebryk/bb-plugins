import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { chooseExecution, headroom, selectExecution, type RoutingModel, type Usage } from "./routing";

const model = (name: string, efforts = ["low", "medium", "high", "xhigh"]): RoutingModel => ({
  model: name, displayName: name, isDefault: false, reasoningDiscovery: "known",
  defaultReasoningEffort: "medium", supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort })),
});
const providers = [
  { id: "alpha", models: [{ ...model("swift"), isDefault: true }, model("astra-2"), model("astra-10")] },
  { id: "beta", models: [model("opus", ["low", "medium", "high"])] },
];
const request = { role: "task" as const, projectId: "project" };
const account = (provider: string, utilization: number | null): Usage["accounts"][number] => ({
  provider, weight: 1, disabled: false, offline: null, blocked: false,
  windows: [{ utilization, rejected: false }],
});
function usage(...accounts: Usage["accounts"]): Usage {
  return { providers: [{ id: "alpha", switchThreshold: 0.95 }, { id: "beta", switchThreshold: 0.95 }], accounts };
}

describe("quota headroom", () => {
  it("uses the tightest window and weights multiple accounts", () => {
    const first = account("alpha", 0.2);
    first.windows.push({ utilization: 0.6, rejected: false });
    first.weight = 3;
    expect(headroom(usage(first, account("alpha", 0.8)), "alpha")).toBeCloseTo(0.35);
  });
  it("does not treat absent, partial, stale, or empty readings as capacity", () => {
    expect(headroom(null, "alpha")).toBeNull();
    expect(headroom(usage(), "alpha")).toBeNull();
    expect(headroom(usage(account("alpha", null)), "alpha")).toBeNull();
    expect(headroom(usage(account("alpha", 0.1), account("alpha", null)), "alpha")).toBeNull();
    expect(headroom(usage({ ...account("alpha", 0.1), offline: "no data" }), "alpha")).toBeNull();
    expect(headroom(usage({ ...account("alpha", 0.1), windows: [] }), "alpha")).toBeNull();
  });
  it("excludes disabled accounts from weighted capacity", () => {
    expect(headroom(usage(account("alpha", 0.3), { ...account("alpha", 0.9), disabled: true }), "alpha")).toBeCloseTo(0.7);
  });
  it("treats exhausted, rejected, and held accounts as unavailable", () => {
    expect(headroom(usage(account("alpha", 0.95)), "alpha")).toBe(0);
    expect(headroom(usage({ ...account("alpha", null), blocked: true }), "alpha")).toBe(0);
    expect(headroom(usage({ ...account("alpha", null), windows: [{ utilization: null, rejected: true }] }), "alpha")).toBe(0);
  });
});

describe("execution policy", () => {
  it("chooses the provider with more reported capacity and a supported effort", () => {
    const result = selectExecution(providers, usage(account("alpha", 0.7), account("beta", 0.1)), request);
    expect(result).toMatchObject({ providerId: "beta", model: "opus", reasoningLevel: "high" });
    expect(result.reason).toContain("90% reported quota headroom");
  });
  it("chooses the newest strongest catalog family within the chosen provider", () => {
    expect(selectExecution(providers, usage(account("alpha", 0.1), account("beta", 0.7)), request))
      .toMatchObject({ providerId: "alpha", model: "astra-10", reasoningLevel: "xhigh" });
  });
  it("uses medium for the coordinator", () => {
    expect(selectExecution(providers, null, { ...request, role: "coordinator" }).reasoningLevel).toBe("medium");
  });
  it("keeps unknown capacity explicit and deterministic", () => {
    const first = selectExecution(providers, null, request);
    expect(first).toEqual(selectExecution(providers, null, request));
    expect(first).toMatchObject({ providerId: "alpha", model: "astra-10" });
    expect(first.reason).toContain("capacity unknown");
    expect(selectExecution(providers, null, { ...request, preferences: [{ providerId: "beta", model: "opus" }] }).providerId).toBe("beta");
  });
  it("prefers measured capacity over unknown and excludes measured exhaustion", () => {
    expect(selectExecution(providers, usage(account("beta", 0.5)), request).providerId).toBe("beta");
    expect(selectExecution(providers, usage(account("alpha", 0.99)), request).providerId).toBe("beta");
    expect(() => selectExecution(providers, usage(account("alpha", 0.99), account("beta", 1)), request)).toThrow("No available model");
  });
  it("validates exact user model and reasoning selections", () => {
    expect(selectExecution(providers, null, { ...request, preferred: { providerId: "beta", model: "opus", reasoningLevel: "low" } }))
      .toMatchObject({ providerId: "beta", model: "opus", reasoningLevel: "low" });
    expect(() => selectExecution(providers, null, { ...request, preferred: { providerId: "beta", model: "invented" } })).toThrow("selected model is unavailable");
    expect(() => selectExecution(providers, null, { ...request, preferred: { providerId: "beta", model: "opus", reasoningLevel: "xhigh" } })).toThrow("not supported");
    expect(() => selectExecution(providers, usage(account("beta", 1)), { ...request, preferred: { providerId: "beta", model: "opus" } })).toThrow("no reported capacity");
  });
  it("never invents reasoning levels when discovery is unknown or custom", () => {
    const unknown = [{ id: "alpha", models: [{ ...model("swift"), reasoningDiscovery: "unknown" as const }] }];
    expect(selectExecution(unknown, null, request)).not.toHaveProperty("reasoningLevel");
    const custom = [{ id: "alpha", models: [{ ...model("custom", ["deliberate"]), defaultReasoningEffort: "deliberate" }] }];
    expect(selectExecution(custom, null, request).reasoningLevel).toBe("deliberate");
    expect(selectExecution([{ id: "alpha", models: [model("none", [])] }], null, request)).not.toHaveProperty("reasoningLevel");
  });
  it("does not send a catalog model to the wrong route provider", () => {
    expect(() => selectExecution([{ id: "alpha", models: [{ ...model("opus"), routeProviderId: "beta" }] }], null, request)).toThrow("No available model");
  });
});

describe("SDK integration", () => {
  function sdk() {
    const list = vi.fn().mockResolvedValue([{ id: "alpha", available: true }, { id: "beta", available: false }]);
    const models = vi.fn().mockResolvedValue({ models: providers[0]!.models, modelLoadError: null });
    const callRpc = vi.fn().mockRejectedValue(new Error("plugin not installed"));
    return { list, models, callRpc, bb: { sdk: { providers: { list, models }, plugins: { callRpc } } } as unknown as BbPluginApi };
  }
  it("scopes model discovery to the environment and tolerates missing Pool Usage", async () => {
    const mock = sdk();
    const result = await chooseExecution(mock.bb, { ...request, environmentId: "env", hostId: "ignored" });
    expect(mock.list).toHaveBeenCalledWith({ environmentId: "env" });
    expect(mock.models).toHaveBeenCalledExactlyOnceWith({ environmentId: "env", providerId: "alpha" });
    expect(result.reason).toContain("capacity unknown");
    expect(mock.callRpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "pool-usage", method: "usage_get", input: null }));
  });
  it("scopes project discovery to the execution host", async () => {
    const mock = sdk();
    await chooseExecution(mock.bb, { ...request, hostId: "host" });
    expect(mock.models).toHaveBeenCalledExactlyOnceWith({ projectId: "project", hostId: "host", providerId: "alpha" });
  });
  it("does not launch from a failed or partial model catalog", async () => {
    const mock = sdk();
    mock.models.mockResolvedValue({ models: providers[0]!.models, modelLoadError: { code: "auth_required" } });
    await expect(chooseExecution(mock.bb, request)).rejects.toThrow("No available model");
  });
});
