import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
  type PluginAppBuilder,
} from "@get-bb/plugin-sdk/app";
import { mountCountdowns } from "./countdown";
import type { ThreadEta, rpcContract } from "./server";
import { ETA_CHANNEL } from "./shared";
import "./app.css";

function ThreadEtas() {
  const { values } = useSettings();
  const rpc = useRpc<typeof rpcContract>();
  const [etas, setEtas] = useState<Record<string, ThreadEta>>({});

  const refetch = useCallback(() => {
    rpc.call("listThreadEtas").then(setEtas, () => undefined);
  }, [rpc]);
  useEffect(refetch, [refetch]);
  useRealtime(ETA_CHANNEL, refetch);
  // A change published while the connection was down arrives with the list.
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (previous.current === "reconnecting" && connection === "connected")
      refetch();
    previous.current = connection;
  }, [connection, refetch]);

  const on = values?.threadEta !== false;
  useEffect(() => (on ? mountCountdowns(etas) : undefined), [on, etas]);
  return null;
}

export default function registerThreadEta(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({
    id: "thread-eta",
    component: ThreadEtas,
  });
}
