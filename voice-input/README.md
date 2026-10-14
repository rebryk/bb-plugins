# Voice Input

Voice Input transcribes BB's voice input on the BB server's Mac with the
Parakeet Ultra speech model on the Neural Engine. The audio never leaves the
Mac. The plugin also removes hesitations such as "um" and "э-э".

```text
microphone in BB ──audio──▶ BB server (Mac)
                              ffmpeg: webm or mp4 → wav
                              parakeet-asr: Parakeet Ultra on the Neural Engine
                              hesitations out
composer       ◀──text──────
```

## Use

- **Dictate.** Click the microphone in any composer, on the Mac or on a phone,
  and speak. Stop adds the text to the draft; send sends it at once.
- **Any of 25 languages.** The model finds the language on its own: English,
  Russian, Ukrainian, German, French, Spanish, and 19 more European
  languages. A take can mix them.
- **Fast.** On an M4, a 10-second take takes about 0.3 seconds, a 40-second
  take 0.8 seconds, and a 20-minute take 24 seconds.
- **Built-in microphone.** Under **Settings** → **Plugins** → **Voice Input**,
  set **Microphone** to **Built-in**, or run
  `bb plugin config voice-input set microphone built-in`
  (`automatic` undoes it). BB's voice input then records with your Mac's,
  iPhone's, or iPad's own microphone, even with AirPods or other headphones
  connected. The setting works with any service that transcribes BB's voice
  input.
- **Automatic.** The default. BB keeps its own choice: **System default**, or
  the microphone you picked under **Settings** → **General** → **Voice Input**.
  That pick also wins over **Built-in**.

## Set up

The BB server must run on a Mac with Apple silicon and macOS 15 or later, with:

- the Xcode Command Line Tools, for `swiftc`: `xcode-select --install`;
- ffmpeg: `brew install ffmpeg`.

Install the plugin, then pick **Parakeet Ultra** for voice input in
**Settings** → **AI services** → **Voice input**, or run:

```sh
bb settings ai-services set voice parakeet --plugin voice-input
```

BB's **Automatic** choice always tries bb cloud first, so the plugin works
only when you pick it.

On its first load the plugin gets ready on its own, and **Settings** →
**AI services** shows each step until it is ready:

1. It downloads the model, 350 MB, from
   `https://d390utbf6y9hg4.cloudfront.net/audio/v3` to
   `~/Library/Application Support/bb-voice-input/parakeet-ultra`.
2. It builds its recognizer, `parakeet-asr`, with `swiftc`, in a few seconds.
3. It opens the model on the Neural Engine. macOS compiles the model for it
   the first time, which takes up to half a minute.

While the plugin is not ready, BB hides the microphone.

To go back to bb cloud, run `bb settings ai-services set voice automatic`.

## How it works

- The plugin registers an AI service for voice input. BB sends it the whole
  recording, up to 25 MB, and waits at most 70 seconds for the text.
- ffmpeg decodes the recording, webm from desktop browsers or mp4 from
  Safari, to a WAV file in a temporary folder.
- `parakeet-asr` resamples the audio to 16 kHz with AVFoundation and runs the
  four Core ML graphs of Parakeet TDT: the preprocessor, the encoder, the
  decoder, and the joint. It decodes greedily: at each 80 ms frame the joint
  names the likeliest token and how many frames to skip.
- The graphs read 15 seconds at a time. A longer take is cut into pieces, each
  cut in the quietest moment of a 5-second stretch. A piece also reads the 4
  seconds before its start and the 3 seconds after its cut, so the words at
  both edges have context, and keeps only the words of its own audio.
- The server removes hesitations: "uh", "um", "erm", "hmm", and "э", "эм",
  "хм", "ммм", also stretched or hyphenated. "um" counts only with a comma or
  a stop after it, since it is also a Portuguese and a German word. A sentence
  that began with a hesitation starts with a capital again.
- One recognizer stays running and keeps the model in memory, about 80 MB.
  When it stops, the next take or status check starts it again. A take that
  BB stops waiting for stops the recognizer too, so later takes do not wait
  behind it.
- The recognizer's Swift source is in `recognizer.ts`. The server builds it
  once per version of that source.
- The plugin's frontend, an `experimental_appOverlay` slot, runs in every BB
  page: the Mac app, a browser, and the iPhone. While **Microphone** is
  **Built-in**, it wraps the browser's `getUserMedia`. A request for audio
  alone that names no microphone then opens the built-in one. A request that
  names a microphone, such as the one you picked in BB's settings, passes
  through unchanged.
- The frontend finds the built-in microphone by name. Chromium marks it
  "(Built-in)", and Safari names it after the MacBook, iMac, iPhone, or iPad. A
  Mac can list a nearby iPhone's microphone, so the iPhone and iPad names count
  only on a touch screen. If it finds none, or opening it fails, BB gets the
  default microphone. Only a denied permission stops the take.
- A browser names its microphones only after the page has opened one, and
  Safari again on every page load. The plugin saves the built-in microphone's
  id in the site's local storage and uses it meanwhile. Only the first take on
  a site opens the default microphone first, then the built-in one.
- Parakeet Ultra is Moondream's post-training of NVIDIA's Parakeet TDT 0.6B
  v3. The plugin runs a Core ML build of it, with the encoder in 4-bit
  palettes. The model is licensed under
  [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/).

## Install

Needs BB 0.46.0 or later.

```sh
bb marketplace add git:https://github.com/rebryk/bb-plugins.git@main
bb plugin install voice-input@sf-plugins
```

Use `bb plugin install .` from this directory instead when working on it
locally.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run build
bb plugin reload voice-input
```

`npm test` also typechecks the worker's Swift source when `swiftc` is on the
Mac.
