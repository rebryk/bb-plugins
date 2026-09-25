import {
  definePluginApp,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useRef } from "react";
import { enhanceNavigation } from "./navigation";
import "./app.css";

function DiaSidebar({
  experimental_Original: Original,
}: ExperimentalSidebarNavigationProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => enhanceNavigation(root.current!), []);
  // BB 0.43's item descriptors omit visibility preferences and accessories.
  // Keep the host-owned controls so their behavior and plugin contexts survive.
  return (
    <div ref={root} className="dia-sidebar" data-dia-sidebar="">
      <Original />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "icons",
    title: "Dia Sidebar",
    description: "Compact, wrapping navigation icons with live indicators.",
    component: DiaSidebar,
  });
});
