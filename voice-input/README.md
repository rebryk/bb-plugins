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

On its first load the plugin gets ready on its own, and **Settings** → **AI
services** shows each step until it is ready:

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
