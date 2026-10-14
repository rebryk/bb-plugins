import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createEngine } from "./engine";
import { stripHesitations } from "./hesitations";

export default function plugin(bb: BbPluginApi): void {
  // BB records in the browser, so app.tsx reads this setting.
  bb.settings.define({
    microphone: {
      type: "select",
      label: "Microphone",
      description:
        "Automatic uses the microphone BB picks on each device. Built-in records with the Mac's, iPhone's, or iPad's own microphone, even with AirPods on. A microphone you picked in Settings → General → Voice Input wins.",
      options: ["automatic", "built-in"],
      experimental_optionLabels: {
        automatic: "Automatic",
        "built-in": "Built-in",
      },
      default: "automatic",
    },
  });

  const engine = createEngine((message) => bb.log.info(message));
  bb.onDispose(() => engine.close());

  bb.experimental_aiServices.register({
    id: "parakeet",
    displayName: "Parakeet Ultra",
    transcribe: async (audio, { signal }) =>
      stripHesitations(await engine.transcribe(audio, signal)),
    status: async () => engine.status(),
  });

  // The model downloads and opens now, so the first take does not wait.
  engine.start().catch((error: Error) => bb.log.warn(error.message));
}
