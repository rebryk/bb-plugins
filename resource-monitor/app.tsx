import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  useRealtime,
  useRealtimeConnectionState,
} from "@get-bb/plugin-sdk/app";
import "./app.css";
import { GuardView } from "./guard-view";
import { LoadColumns, MeterBars } from "./meter";
import { ProcessesView } from "./processes-view";
import { SAMPLE_CHANNEL, sampleSchema, type Sample } from "./shared";

const ICON_NAME = "resource-monitor/meter";

// Host-drawn icons get no plugin context, so SDK hooks throw inside them.
// SampleFeed has that context; it fills this store, and the icon reads it.
let latest: Sample | null = null;
// Kept through a dropped connection, so Pause all stays when it matters most.
let guardSupported = false;
const listeners = new Set<() => void>();

function setLatest(sample: Sample | null) {
  latest = sample;
  if (sample) guardSupported = sample.guard === true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const useSample = () => useSyncExternalStore(subscribe, () => latest);
const useGuardSupported = () =>
  useSyncExternalStore(subscribe, () => guardSupported);

/** Renders nothing; passes each new sample to the store. */
function SampleFeed() {
  const connection = useRealtimeConnectionState();
  // Without a connection the last sample goes stale; show none instead.
  useEffect(() => {
    if (connection !== "connected") setLatest(null);
  }, [connection]);
  useRealtime(SAMPLE_CHANNEL, (payload) => {
    const parsed = sampleSchema.safeParse(payload);
    if (parsed.success) setLatest(parsed.data);
  });
  return null;
}

/** The rail tile's box while the mouse rests on it, else null. */
function useRailHover(icon: RefObject<SVGSVGElement | null>) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  useEffect(() => {
    const tile = icon.current?.closest("[data-nav-rail-item]");
    if (!(tile instanceof HTMLElement)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.buttons !== 0) return;
      clearTimeout(timer);
      timer = setTimeout(() => setAnchor(tile.getBoundingClientRect()), 150);
    };
    // Also on pointerdown, so the card doesn't hang over the page it opens.
    const hide = () => {
      clearTimeout(timer);
      setAnchor(null);
    };
    // BB's own tooltip opens on pointermove; the card replaces it.
    const muteTooltip = (event: PointerEvent) => {
      if (event.buttons === 0) event.stopPropagation();
    };
    tile.addEventListener("pointerenter", show);
    tile.addEventListener("pointerleave", hide);
    tile.addEventListener("pointerdown", hide);
    tile.addEventListener("pointermove", muteTooltip, true);
    return () => {
      hide();
      tile.removeEventListener("pointerenter", show);
      tile.removeEventListener("pointerleave", hide);
      tile.removeEventListener("pointerdown", hide);
      tile.removeEventListener("pointermove", muteTooltip, true);
    };
  }, [icon]);
  return anchor;
}

function HoverCard({ anchor }: { anchor: DOMRect }) {
  const sample = useSample();
  const card = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.top);
  // Center the card on the tile, inside the window.
  useLayoutEffect(() => {
    const height = card.current?.offsetHeight ?? 0;
    const centered = anchor.top + (anchor.height - height) / 2;
    setTop(Math.max(8, Math.min(centered, innerHeight - height - 8)));
  }, [anchor]);
  return createPortal(
    <div
      ref={card}
      className="rm-card"
      style={{ left: anchor.right + 10, top }}
      role="tooltip"
    >
      <LoadColumns sample={sample} />
    </div>,
    document.body,
  );
}

/** The sidebar icon: live load as three bars, the numbers in a card. */
function RailIcon({ className }: { className?: string }) {
  const sample = useSample();
  const icon = useRef<SVGSVGElement>(null);
  const anchor = useRailHover(icon);
  return (
    <>
      <svg ref={icon} viewBox="0 0 16 16" className={className} fill="currentColor">
        <MeterBars sample={sample} />
      </svg>
      {anchor && <HoverCard anchor={anchor} />}
    </>
  );
}

function ResourcesPage() {
  const sample = useSample();
  // Older servers send no `guard`; Guard needs BB's app on macOS.
  const guard = useGuardSupported();
  return (
    <div className="rm-page">
      <div>
        {sample && (
          <p className="rm-detail">
            {sample.hostname.split(".")[0]} · up {uptime(sample.uptimeSeconds)}
          </p>
        )}
        <div className="rm-columns">
          <LoadColumns sample={sample} details />
        </div>
        {guard && <GuardView />}
        <ProcessesView />
      </div>
    </div>
  );
}

function uptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: ICON_NAME, component: RailIcon });
  app.slots.experimental_appOverlay({ id: "sampleFeed", component: SampleFeed });
  app.slots.navPanel({
    id: "resources",
    title: "Resources",
    icon: ICON_NAME,
    path: "resources",
    component: ResourcesPage,
  });
});
