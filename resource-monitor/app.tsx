import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import "./app.css";
import { ResourceCard } from "./cards";
import { ICONS } from "./icons";
import type { rpcContract } from "./server";
import {
  CARD_STYLES,
  ICON_STYLES,
  SAMPLE_CHANNEL,
  lookSchema,
  sampleSchema,
  type CardStyle,
  type IconStyle,
  type Look,
} from "./shared";
import { addSample, setLook, setSamples, useMonitor } from "./store";

const ICON_NAME = "resource-monitor/meter";

/** Renders nothing; keeps the store in step with the server. */
function SampleFeed() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const { values } = useSettings();
  // On mount, and once a dropped connection is back.
  useEffect(() => {
    if (connection !== "connected") return;
    rpc.call("listResourceSamples", null).then(setSamples, () => {});
  }, [rpc, connection]);
  useRealtime(SAMPLE_CHANNEL, (payload) => {
    const parsed = sampleSchema.safeParse(payload);
    if (parsed.success) addSample(parsed.data);
  });
  useEffect(() => {
    const parsed = lookSchema.partial().safeParse(values ?? {});
    if (parsed.success) setLook(parsed.data);
  }, [values]);
  return null;
}

/** The rail tile's box while the pointer rests on it, else null. */
function useRailHover(icon: React.RefObject<SVGSVGElement | null>) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  useEffect(() => {
    const tile = icon.current?.closest("[data-nav-rail-item]");
    if (!(tile instanceof HTMLElement)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      timer = setTimeout(() => setAnchor(tile.getBoundingClientRect()), 150);
    };
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
  const { samples, look } = useMonitor();
  const card = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.top);
  // Keep the card on screen when the tile sits low in the rail.
  useLayoutEffect(() => {
    const height = card.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(anchor.top - 8, innerHeight - height - 8)));
  }, [anchor, samples.length, look.cardStyle]);
  return createPortal(
    <div
      ref={card}
      className="rm-popover"
      style={{ left: anchor.right + 10, top }}
      role="tooltip"
    >
      <ResourceCard style={look.cardStyle} samples={samples} />
    </div>,
    document.body,
  );
}

/** The sidebar icon: live load in the chosen style, details on hover. */
function RailIcon({ className }: { className?: string }) {
  const { samples, look } = useMonitor();
  const icon = useRef<SVGSVGElement>(null);
  const anchor = useRailHover(icon);
  return (
    <>
      <svg ref={icon} viewBox="0 0 16 16" className={className} fill="currentColor">
        {ICONS[look.iconStyle](samples)}
      </svg>
      {anchor && <HoverCard anchor={anchor} />}
    </>
  );
}

function Choice({
  selected,
  label,
  onPick,
  children,
}: {
  selected: boolean;
  label: string;
  onPick: () => void;
  children: React.ReactNode;
}) {
  const [name, hint] = label.split(": ");
  return (
    <button
      type="button"
      className="rm-choice"
      aria-pressed={selected}
      onClick={onPick}
    >
      {children}
      <span className="rm-choice-label">
        {name}
        <span className="rm-muted">{selected ? "In use" : "Use"}</span>
      </span>
      <span className="rm-muted">{hint}</span>
    </button>
  );
}

/** Every icon and card style, live, to compare and pick from. */
function GalleryPage() {
  const rpc = useRpc<typeof rpcContract>();
  const { samples, look } = useMonitor();
  const pick = (next: Partial<Look>) => {
    setLook(next);
    rpc.call("setResourceLook", next).then(setLook, () => {});
  };
  return (
    <div className="rm-page">
      <h2>Sidebar icon</h2>
      <p className="rm-muted">
        Each style draws the live load. The small copy is the sidebar size.
      </p>
      <div className="rm-grid">
        {(Object.keys(ICON_STYLES) as IconStyle[]).map((style) => (
          <Choice
            key={style}
            selected={look.iconStyle === style}
            label={ICON_STYLES[style]}
            onPick={() => pick({ iconStyle: style })}
          >
            <span className="rm-icon-previews">
              <svg viewBox="0 0 16 16" className="rm-icon-large" fill="currentColor">
                {ICONS[style](samples)}
              </svg>
              <svg viewBox="0 0 16 16" className="rm-icon-small" fill="currentColor">
                {ICONS[style](samples)}
              </svg>
            </span>
          </Choice>
        ))}
      </div>
      <h2>Hover card</h2>
      <p className="rm-muted">Hover the sidebar icon to see the card in use.</p>
      <div className="rm-cards">
        {(Object.keys(CARD_STYLES) as CardStyle[]).map((style) => (
          <Choice
            key={style}
            selected={look.cardStyle === style}
            label={CARD_STYLES[style]}
            onPick={() => pick({ cardStyle: style })}
          >
            <ResourceCard style={style} samples={samples} />
          </Choice>
        ))}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.experimental_icons.register({ name: ICON_NAME, component: RailIcon });
  app.slots.experimental_appOverlay({ id: "sampleFeed", component: SampleFeed });
  app.slots.navPanel({
    id: "resources",
    title: "Resources",
    icon: ICON_NAME,
    path: "resources",
    component: GalleryPage,
  });
});
