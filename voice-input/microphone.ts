type Device = Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">;

/**
 * Ids of no microphone in particular: Chromium's entries for the system's
 * choice, and the blank id browsers give before the page may see microphones.
 */
const STAND_INS = new Set(["", "default", "communications"]);
/**
 * The built-in microphone's id, kept for takes before the browser names
 * microphones. A site keeps its ids until its data, this key with it, is
 * cleared.
 */
const KEY = "voice-input:built-in-microphone";

/** The id an earlier take found, if this browser remembers one. */
function savedMicrophone(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Storage can be unavailable.
    return null;
  }
}

/**
 * The id of the device's own microphone, or null. Browsers name it after the
 * device in any language: "MacBook Pro Microphone (Built-in)" in Chromium,
 * "Микрофон MacBook Pro" in Safari, "iPhone Microphone" on an iPhone. A Mac
 * can also list a nearby iPhone's microphone, so the iPhone and iPad names
 * count only on a touch screen.
 */
export function builtInMicrophone(
  devices: Device[],
  touch: boolean,
): string | null {
  const microphones = devices.filter(
    ({ kind, deviceId }) => kind === "audioinput" && !STAND_INS.has(deviceId),
  );
  const names = touch
    ? [/\b(?:iPhone|iPad)\b/i]
    : [/\b(?:MacBook|iMac)\b/i, /built-in/i];
  for (const name of names) {
    const found = microphones.find(({ label }) => name.test(label));
    if (found) return found.deviceId;
  }
  return null;
}

/**
 * Has requests for the default microphone record with the device's own one,
 * and returns a function that undoes it. Requests that name a microphone, such
 * as one picked in BB's settings, or that want video, pass through.
 */
export function preferBuiltInMicrophone(media: MediaDevices): () => void {
  const original = media.getUserMedia;
  const open = (constraints?: MediaStreamConstraints) =>
    original.call(media, constraints);
  const find = async () => {
    const id = builtInMicrophone(
      await media.enumerateDevices().catch(() => []),
      navigator.maxTouchPoints > 0,
    );
    try {
      if (id !== null) localStorage.setItem(KEY, id);
    } catch {
      // Without storage, takes before the browser names microphones open the
      // default first.
    }
    return id;
  };

  media.getUserMedia = async (constraints) => {
    const { audio, video } = constraints ?? {};
    if (!audio || video || (audio !== true && audio.deviceId !== undefined))
      return open(constraints);
    // Browsers name microphones only once the page has opened one; Safari
    // once per page load. Until then, the id an earlier take found stands in.
    let id = (await find()) ?? savedMicrophone();
    if (id === null) {
      const stream = await open(constraints);
      id = await find();
      const opened = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (id === null || opened === id) return stream;
      stream.getTracks().forEach((track) => track.stop());
    }
    try {
      const asked = audio === true ? {} : audio;
      return await open({ audio: { ...asked, deviceId: { exact: id } } });
    } catch (error) {
      // Gone, busy, or any other failure: the default still records. Only a
      // denied permission stops the take.
      if ((error as Error)?.name === "NotAllowedError") throw error;
      return open(constraints);
    }
  };
  return () => {
    // The browser's own method lives on the prototype, unless a script
    // replaced it before this one.
    delete (media as Partial<MediaDevices>).getUserMedia;
    if (media.getUserMedia !== original) media.getUserMedia = original;
  };
}
