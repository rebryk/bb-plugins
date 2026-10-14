import { useEffect } from "react";
import { definePluginApp, useSettings } from "@get-bb/plugin-sdk/app";
import { preferBuiltInMicrophone } from "./microphone";

/** BB records with the device's own microphone while the setting says so. */
function Microphone() {
  const builtIn = useSettings().values?.microphone === "built-in";
  useEffect(() => {
    // Outside HTTPS and localhost, browsers offer no microphones.
    if (builtIn && navigator.mediaDevices)
      return preferBuiltInMicrophone(navigator.mediaDevices);
  }, [builtIn]);
  return null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "microphone",
    component: Microphone,
  });
});
