import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createEngine } from "./engine";
import { stripHesitations } from "./hesitations";

export default function plugin(bb: BbPluginApi): void {
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
