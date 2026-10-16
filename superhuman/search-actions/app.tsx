import { useCallback } from "react";
import {
  useRpc,
  useSdk,
  useSettings,
  type PluginAppBuilder,
} from "@get-bb/plugin-sdk/app";
import { showError } from "../snooze/app";
import type { rpcContract } from "../snooze/server";
import { useSearchAdapter } from "../universal-search/app";
import { installSearchActions, type SearchThread } from "./rows";

function SearchActions() {
  const { values, isLoading } = useSettings();
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const install = useCallback(
    (disposers: (() => void)[], invalidate: () => Promise<void>) => {
      const action = (label: string, call: () => Promise<unknown>) => ({
        label,
        run: () =>
          call().then(invalidate, (error: unknown) =>
            showError(`Could not ${label.toLowerCase()} the thread`, error),
          ),
      });
      const actionFor = (thread: SearchThread) => {
        const threadId = thread.id;
        if (thread.archivedAt !== null && thread.archivedAt !== undefined) {
          return action("Unarchive", () => sdk.threads.unarchive({ threadId }));
        }
        // Only Snooze adds hidden threads to BB's thread search.
        if (thread.visibility === "hidden") {
          return action("Unsnooze", () => rpc.call("unsnooze", { threadId }));
        }
        return null;
      };
      disposers.push(installSearchActions(document, actionFor));
    },
    [sdk, rpc],
  );
  const anchor = useSearchAdapter(
    !isLoading && values?.searchActions !== false,
    install,
  );
  return <span ref={anchor} hidden aria-hidden="true" />;
}

export default function registerSearchActions(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({
    id: "search-actions",
    component: SearchActions,
  });
}
