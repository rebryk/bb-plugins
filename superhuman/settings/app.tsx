import { useSdk, useSettings, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { experimentalSettings } from "./options";
import "./app.css";

function ExperimentalSettings() {
  const sdk = useSdk();
  const { values } = useSettings();
  const [saved, setSaved] = useState(values);
  const [saving, setSaving] = useState<Record<string, boolean> | null>(null);
  useEffect(() => { if (values) setSaved(values); }, [values]);
  const anchor = useRef<HTMLSpanElement>(null);
  const [target, setTarget] = useState<Element | null>(null);
  useLayoutEffect(() => {
    const configuration = anchor.current?.closest("section[data-resource-detail-section]");
    if (!configuration) return;
    // BB nests settings slots in Configuration; give this one matching chrome.
    const section = configuration.cloneNode(false) as Element;
    section.setAttribute("data-resource-detail-section", "experimental");
    const header = configuration.firstElementChild!.cloneNode(true) as Element;
    header.querySelector("h2")!.textContent = "Experimental";
    const content = document.createElement("div");
    content.dataset.testid = "plugin-detail-superhuman-experimental";
    section.append(header, content);
    configuration.after(section);
    setTarget(content);
    return () => section.remove();
  }, []);
  async function toggle(key: string) {
    const patch = { [key]: saved?.[key] === false };
    setSaving(patch);
    try {
      await sdk.plugins.updateSettings({ pluginId: "superhuman", values: patch });
      setSaved((current) => ({ ...current, ...patch }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the setting.");
    } finally {
      setSaving(null);
    }
  }
  const card = (
    <div data-superhuman-experimental className="overflow-hidden rounded-md border border-border bg-surface-recessed/70 px-3 py-3">
      <div className="space-y-4">
        {Object.entries(experimentalSettings).map(([key, setting]) => {
          const state = (saving?.[key] ?? saved?.[key]) === false ? "unchecked" : "checked";
          return (
            <div key={key} data-control-placement="trailing" className="flex flex-row justify-between gap-5 items-start">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-normal text-foreground">{setting.label}</p>
                <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">{setting.description}</p>
              </div>
              <div className="flex shrink-0 justify-end">
                <button type="button" role="switch" aria-label={setting.label} aria-checked={state === "checked"}
                  data-state={state} disabled={!!saving || !saved} onClick={() => void toggle(key)}
                  className="peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input shadow-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-foreground data-[state=unchecked]:border-input data-[state=unchecked]:bg-muted">
                  <span aria-hidden="true" data-state={state} className="pointer-events-none block size-3 rounded-full bg-background transition-transform data-[state=unchecked]:bg-foreground data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
  return <><span ref={anchor} hidden />{target && createPortal(card, target)}</>;
}

export default function registerSettings(app: PluginAppBuilder) {
  app.slots.settingsSection({ id: "experimental-settings", component: ExperimentalSettings });
}
