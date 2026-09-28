import { HugeiconsIcon } from "@hugeicons/react";
import Archive03Icon from "@hugeicons/core-free-icons/Archive03Icon";
import {
  experimental_useSidebarThreadActions,
  useSettings,
  type PluginAppBuilder,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import "./app.css";

// BB's own archive, as in the thread's menu: children too, with its toast.
function ArchiveButton({ threadId }: PluginThreadHeaderActionProps) {
  const { values } = useSettings();
  const actions = experimental_useSidebarThreadActions();
  if (values?.archiveButton === false) return null;
  return (
    <button
      type="button"
      aria-label="Archive thread"
      title="Archive thread"
      onClick={() => actions.archive(threadId)}
      className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-[color:var(--subtle-foreground)] transition-colors duration-150 hover:bg-[var(--state-hover)] hover:text-muted-foreground hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:size-9"
    >
      <HugeiconsIcon
        icon={Archive03Icon}
        size={16}
        strokeWidth={1.5}
        className="max-md:pointer-coarse:size-5"
        // How BB marks its own icons, so the styles for those color it too.
        data-icon-root=""
      />
    </button>
  );
}

export default function registerArchiveButton(app: PluginAppBuilder) {
  app.slots.experimental_threadHeaderAction({
    id: "archive",
    title: "Archive thread",
    component: ArchiveButton,
  });
}
