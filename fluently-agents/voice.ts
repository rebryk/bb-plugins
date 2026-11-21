import { useEffect, useRef, useState } from 'react';
import { useSdk } from '@get-bb/plugin-sdk/app';

export type VoiceState = 'idle' | 'starting' | 'recording' | 'transcribing' | 'error';
export function useVoiceTranscript(options: { threadId: string; onTranscript(text: string): void | Promise<void>; onError(message: string): void }) {
  const sdk = useSdk();
  const callbacks = useRef(options); callbacks.current = options;
  const [state, setState] = useState<VoiceState>('idle');
  const [level, setLevel] = useState(0);
  const [failedRecording, setFailedRecording] = useState<Blob | null>(null);
  const stateRef = useRef<VoiceState>('idle');
  const session = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);
  const request = useRef<AbortController | null>(null);
  function change(next: VoiceState) { stateRef.current = next; setState(next); }
  function release() {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null;
    void audio.current?.close().catch(() => {}); audio.current = null;
    setLevel(0);
  }
  function cancel() {
    session.current++; request.current?.abort(); request.current = null;
    const current = recorder.current; recorder.current = null;
    if (current && current.state !== 'inactive') current.stop();
    release(); setFailedRecording(null); change('idle');
  }
  useEffect(() => () => {
    session.current++; request.current?.abort();
    const current = recorder.current; recorder.current = null;
    if (current && current.state !== 'inactive') current.stop();
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    void audio.current?.close().catch(() => {});
  }, [options.threadId]);
  async function transcribe(blob: Blob, token: number) {
    if (!blob.size) { change('idle'); callbacks.current.onError('No audio was recorded. Try again.'); return; }
    change('transcribing');
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await sdk.system.transcribeVoice({ file: blob, signal: controller.signal });
      if (token !== session.current) return;
      const text = response.text.trim();
      if (!text) throw new Error('No speech was detected. Retry or record again.');
      setFailedRecording(null); change('idle');
      // A send failure must never become a retryable audio transcription.
      try { await callbacks.current.onTranscript(text); }
      catch (error) { callbacks.current.onError(error instanceof Error ? error.message : 'Could not deliver the transcript.'); }
    } catch (error) {
      if (token !== session.current) return;
      setFailedRecording(blob); change('error');
      callbacks.current.onError(error instanceof Error ? error.message : 'Voice transcription failed. Retry the recording.');
    } finally { if (request.current === controller) request.current = null; }
  }
  async function toggle() {
    if (stateRef.current === 'recording') { recorder.current?.stop(); change('transcribing'); return; }
    if (stateRef.current === 'starting' || stateRef.current === 'transcribing') return;
    const token = ++session.current;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      change('error'); callbacks.current.onError('Voice recording is unavailable in this browser.'); return;
    }
    change('starting'); setFailedRecording(null);
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (token !== session.current) { input.getTracks().forEach(track => track.stop()); return; }
      stream.current = input;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(input, mimeType ? { mimeType } : undefined);
      recorder.current = recording;
      const chunks: Blob[] = [];
      recording.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recording.onerror = () => { if (token === session.current) { cancel(); change('error'); callbacks.current.onError('Recording failed. Please try again.'); } };
      recording.onstop = () => {
        if (token !== session.current) return;
        recorder.current = null; release();
        void transcribe(new Blob(chunks, { type: recording.mimeType || 'audio/webm' }), token);
      };
      recording.start(1000); change('recording');
      // Audio visualization is optional; microphone capture still works without it.
      try {
        const context = new AudioContext(); audio.current = context;
        const analyser = context.createAnalyser(); analyser.fftSize = 256;
        context.createMediaStreamSource(input).connect(analyser);
        const samples = new Uint8Array(analyser.frequencyBinCount);
        const update = () => {
          if (token !== session.current || stateRef.current !== 'recording') return;
          analyser.getByteTimeDomainData(samples);
          const energy = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
          setLevel(Math.min(1, energy * 5)); frame.current = requestAnimationFrame(update);
        };
        update();
      } catch { /* Capture does not depend on the visualizer. */ }
    } catch (error) {
      if (token !== session.current) return;
      release(); change('error'); callbacks.current.onError(error instanceof Error ? error.message : 'Could not access the microphone.');
    }
  }
  function retry() { if (failedRecording) void transcribe(failedRecording, ++session.current); }
  return { state, level, failedRecording, toggle, cancel, retry };
}
