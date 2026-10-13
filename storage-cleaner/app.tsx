// Storage Cleaner lives on its settings page, and the same view is a page
// that Customize rail can put in the sidebar.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Explorer } from "./explorer";
import { Categories, FreeSpace } from "./overview";
import { StorageProvider } from "./ui";

/** Free space and categories, then the explorer. */
function StorageSection() {
  return (
    <StorageProvider>
      <div className="space-y-10">
        <div className="space-y-5">
          <FreeSpace />
          <Categories />
        </div>
        <Explorer />
      </div>
    </StorageProvider>
  );
}

function StoragePage() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-4 pb-10 pt-4 md:pt-5">
        <StorageSection />
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "storage",
    title: "Storage",
    component: StorageSection,
  });
  app.slots.navPanel({
    id: "storage",
    title: "Storage",
    icon: "Clean",
    path: "storage",
    component: StoragePage,
  });
});
