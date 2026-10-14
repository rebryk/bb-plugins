import { beforeEach, expect, it, vi } from "vitest";
import { builtInMicrophone, preferBuiltInMicrophone } from "./microphone";

const KEY = "voice-input:built-in-microphone";
// Node's own localStorage works only with --localstorage-file.
const saved = new Map<string, string>();
beforeEach(() => {
  saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
  });
});

const mic = (deviceId: string, label: string) => ({
  kind: "audioinput" as const,
  deviceId,
  label,
});

it.each([
  {
    on: "Chromium on a Mac",
    touch: false,
    devices: [
      mic("default", "Default - MacBook Pro Microphone (Built-in)"),
      mic("airpods", "AirPods Pro (Bluetooth)"),
      mic("mac", "MacBook Pro Microphone (Built-in)"),
    ],
    expected: "mac",
  },
  {
    on: "Safari on a Mac in Russian",
    touch: false,
    devices: [
      mic("airpods", "AirPods Pro"),
      mic("mac", "Микрофон MacBook Pro"),
    ],
    expected: "mac",
  },
  {
    on: "a Mac next to an iPhone",
    touch: false,
    devices: [
      mic("phone", "Anna’s iPhone Microphone"),
      mic("mac", "MacBook Air Microphone"),
    ],
    expected: "mac",
  },
  {
    on: "an older macOS",
    touch: false,
    devices: [mic("airpods", "AirPods"), mic("mac", "Built-in Microphone")],
    expected: "mac",
  },
  {
    on: "an iPhone with AirPods",
    touch: true,
    devices: [mic("airpods", "AirPods Pro"), mic("phone", "iPhone Microphone")],
    expected: "phone",
  },
  {
    on: "an iPhone in Russian",
    touch: true,
    devices: [mic("phone", "Микрофон iPhone")],
    expected: "phone",
  },
  {
    on: "a Mac with no microphone of its own",
    touch: false,
    devices: [
      mic("airpods", "AirPods Pro (Bluetooth)"),
      {
        ...mic("camera", "FaceTime HD Camera (Built-in)"),
        kind: "videoinput" as const,
      },
    ],
    expected: null,
  },
])("finds the built-in microphone on $on", ({ devices, touch, expected }) => {
  expect(builtInMicrophone(devices, touch)).toBe(expected);
});

const MAC = [
  mic("default", "Default - AirPods Pro (Bluetooth)"),
  mic("airpods", "AirPods Pro (Bluetooth)"),
  mic("mac", "MacBook Pro Microphone (Built-in)"),
];

/** A stream from the microphone `deviceId`. */
function stream(deviceId: string) {
  const track = { stop: vi.fn(), getSettings: () => ({ deviceId }) };
  return { getAudioTracks: () => [track], getTracks: () => [track] };
}

const deviceOf = (stream: MediaStream) =>
  stream.getAudioTracks()[0]!.getSettings().deviceId;

/**
 * A Mac's MediaDevices, with `fallback` as its default microphone. With
 * `hidden`, it names microphones only once one has opened, as Safari does.
 */
function fakeMedia({ hidden = false, fallback = "airpods" } = {}) {
  let opened = false;
  const getUserMedia = vi.fn(async ({ audio }: MediaStreamConstraints) => {
    opened = true;
    const named =
      typeof audio === "object" && (audio.deviceId as { exact: string });
    return stream(named ? named.exact : fallback);
  });
  const enumerateDevices = async () =>
    hidden && !opened ? [mic("", "")] : MAC;
  // Browsers keep getUserMedia on the prototype.
  const media = Object.assign(Object.create({ getUserMedia }), {
    enumerateDevices,
  }) as MediaDevices;
  return { media, getUserMedia };
}

it("records with the built-in microphone when asked for the default", async () => {
  const { media, getUserMedia } = fakeMedia();
  preferBuiltInMicrophone(media);
  const opened = await media.getUserMedia({
    audio: { echoCancellation: true },
  });
  expect(deviceOf(opened)).toBe("mac");
  expect(getUserMedia.mock.calls).toEqual([
    [{ audio: { echoCancellation: true, deviceId: { exact: "mac" } } }],
  ]);
  expect(localStorage.getItem(KEY)).toBe("mac");
});

it("passes through requests that name a microphone or want video", async () => {
  const { media, getUserMedia } = fakeMedia();
  preferBuiltInMicrophone(media);
  const picked = { audio: { deviceId: { exact: "airpods" } } };
  const video = { audio: true, video: true };
  await media.getUserMedia(picked);
  await media.getUserMedia(video);
  expect(getUserMedia.mock.calls).toEqual([[picked], [video]]);
});

it("opens the default while microphones have no names, then switches", async () => {
  const { media, getUserMedia } = fakeMedia({ hidden: true });
  preferBuiltInMicrophone(media);
  const opened = await media.getUserMedia({ audio: true });
  expect(deviceOf(opened)).toBe("mac");
  expect(getUserMedia.mock.calls).toEqual([
    [{ audio: true }],
    [{ audio: { deviceId: { exact: "mac" } } }],
  ]);
  const first = await getUserMedia.mock.results[0]!.value;
  expect(first.getTracks()[0].stop).toHaveBeenCalled();
});

it("keeps the default when it already is the built-in microphone", async () => {
  const { media, getUserMedia } = fakeMedia({ hidden: true, fallback: "mac" });
  preferBuiltInMicrophone(media);
  const opened = await media.getUserMedia({ audio: true });
  expect(deviceOf(opened)).toBe("mac");
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(opened.getTracks()[0]!.stop).not.toHaveBeenCalled();
});

it("opens the microphone found on an earlier take while names are hidden", async () => {
  localStorage.setItem(KEY, "mac");
  const { media, getUserMedia } = fakeMedia({ hidden: true });
  preferBuiltInMicrophone(media);
  const opened = await media.getUserMedia({ audio: true });
  expect(deviceOf(opened)).toBe("mac");
  expect(getUserMedia.mock.calls).toEqual([
    [{ audio: { deviceId: { exact: "mac" } } }],
  ]);
});

it.each([
  ["is gone", "gone", "OverconstrainedError"],
  ["is busy", "mac", "NotReadableError"],
  ["can't take over from AirPods", "mac", "AbortError"],
])(
  "opens the default when the built-in microphone %s",
  async (_, saved, error) => {
    localStorage.setItem(KEY, saved);
    const { media, getUserMedia } = fakeMedia({ hidden: true });
    getUserMedia.mockRejectedValueOnce(new DOMException("Failed", error));
    preferBuiltInMicrophone(media);
    const opened = await media.getUserMedia({ audio: true });
    expect(deviceOf(opened)).toBe("airpods");
    expect(getUserMedia.mock.calls).toEqual([
      [{ audio: { deviceId: { exact: saved } } }],
      [{ audio: true }],
    ]);
  },
);

it("records without storage and stops the default it opened", async () => {
  const blocked = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
  const { media, getUserMedia } = fakeMedia({ hidden: true });
  preferBuiltInMicrophone(media);
  const opened = await media.getUserMedia({ audio: true });
  expect(deviceOf(opened)).toBe("mac");
  const first = await getUserMedia.mock.results[0]!.value;
  expect(first.getTracks()[0].stop).toHaveBeenCalled();
});

it("lets a denied permission through as it is", async () => {
  const { media, getUserMedia } = fakeMedia();
  const denied = new DOMException("Permission denied", "NotAllowedError");
  getUserMedia.mockRejectedValueOnce(denied);
  preferBuiltInMicrophone(media);
  await expect(media.getUserMedia({ audio: true })).rejects.toBe(denied);
  expect(getUserMedia).toHaveBeenCalledOnce();
});

it("puts the browser's own getUserMedia back", () => {
  const { media, getUserMedia } = fakeMedia();
  const restore = preferBuiltInMicrophone(media);
  expect(media.getUserMedia).not.toBe(getUserMedia);
  restore();
  expect(media.getUserMedia).toBe(getUserMedia);
  expect(Object.hasOwn(media, "getUserMedia")).toBe(false);
});
