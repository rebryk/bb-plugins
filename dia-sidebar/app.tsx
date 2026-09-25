import {
  definePluginApp,
  type ExperimentalSidebarNavigationProps,
} from "@get-bb/plugin-sdk/app";
import { mountNavigationLabels } from "./navigation-labels";
import { mountAccessoryFit } from "./accessory-fit";
import "./app.css";

function DiaSidebar({
  experimental_Original: Original,
}: ExperimentalSidebarNavigationProps) {
  // BB 0.43's item descriptors omit visibility preferences and accessories.
  // Keep the host-owned controls so their behavior and plugin contexts survive.
  return (
    <div className="dia-sidebar" data-dia-sidebar="">
      <Original />
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "navigation-labels",
    mount: () => mountNavigationLabels(document),
  });
  app.contentScripts.register({
    id: "accessory-fit",
    mount: () => mountAccessoryFit(document),
  });
  app.slots.experimental_sidebarNavigation({
    id: "icons",
    title: "Dia Sidebar",
    description: "Compact, wrapping navigation icons with live indicators.",
    component: DiaSidebar,
  });
});
