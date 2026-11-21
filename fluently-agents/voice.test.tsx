// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useVoiceTranscript } from './voice';
const { transcribeVoice } = vi.hoisted(() => ({ transcribeVoice: vi.fn() }));
vi.mock('@get-bb/plugin-sdk/app', () => ({ useSdk: () => ({ system: { transcribeVoice } }) }));
let stopTrack: ReturnType<typeof vi.fn>;
let input: MediaStream;
class Recorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }
}
beforeEach(() => {
  stopTrack = vi.fn(); input = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
  vi.stubGlobal('MediaRecorder', Recorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(input) } });
  transcribeVoice.mockReset().mockResolvedValue({ text: 'Create a task' });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('records, releases the microphone, and transcribes through BB', async () => {
  const onTranscript = vi.fn();
  const { result } = renderHook(() => useVoiceTranscript({ threadId: 'one', onTranscript, onError: vi.fn() }));
  await act(() => result.current.toggle());
  expect(result.current.state).toBe('recording');
  await act(() => result.current.toggle());
  await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('Create a task'));
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(transcribeVoice.mock.calls[0]![0].file.size).toBeGreaterThan(0);
});
it('does not deliver a late transcript to another conversation', async () => {
  let resolve!: (value: { text: string }) => void;
  transcribeVoice.mockReturnValue(new Promise(r => { resolve = r; }));
  const onTranscript = vi.fn();
  const { result, rerender } = renderHook(({ threadId }) => useVoiceTranscript({ threadId, onTranscript, onError: vi.fn() }), { initialProps: { threadId: 'one' } });
  await act(() => result.current.toggle());
  await act(() => result.current.toggle());
  rerender({ threadId: 'two' });
  await act(async () => resolve({ text: 'For the first thread' }));
  expect(onTranscript).not.toHaveBeenCalled();
  expect(transcribeVoice.mock.calls[0]![0].signal.aborted).toBe(true);
});
it('releases a microphone granted after unmount', async () => {
  let resolve!: (value: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise(r => { resolve = r; }));
  const { result, unmount } = renderHook(() => useVoiceTranscript({ threadId: 'one', onTranscript: vi.fn(), onError: vi.fn() }));
  let pending!: Promise<void>;
  act(() => { pending = result.current.toggle(); });
  unmount();
  await act(async () => { resolve(input); await pending; });
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(transcribeVoice).not.toHaveBeenCalled();
});
it('retains failed audio for retry and discards it on cancel', async () => {
  transcribeVoice.mockRejectedValueOnce(new Error('Temporarily unavailable'));
  const onError = vi.fn(), onTranscript = vi.fn();
  const { result } = renderHook(() => useVoiceTranscript({ threadId: 'one', onTranscript, onError }));
  await act(() => result.current.toggle()); await act(() => result.current.toggle());
  await waitFor(() => expect(result.current.state).toBe('error'));
  expect(result.current.failedRecording?.size).toBeGreaterThan(0);
  await act(() => result.current.retry());
  await waitFor(() => expect(onTranscript).toHaveBeenCalledOnce());
  expect(result.current.failedRecording).toBeNull();
  act(() => result.current.cancel());
  expect(result.current.state).toBe('idle');
});
it('cancel stops capture without transcribing or sending', async () => {
  const onTranscript = vi.fn();
  const { result } = renderHook(() => useVoiceTranscript({ threadId: 'one', onTranscript, onError: vi.fn() }));
  await act(() => result.current.toggle()); act(() => result.current.cancel());
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(transcribeVoice).not.toHaveBeenCalled(); expect(onTranscript).not.toHaveBeenCalled();
});
it('does not offer transcription retry when delivery fails', async () => {
  const onError = vi.fn();
  const { result } = renderHook(() => useVoiceTranscript({ threadId: 'one', onTranscript: async () => { throw new Error('Send failed'); }, onError }));
  await act(() => result.current.toggle()); await act(() => result.current.toggle());
  await waitFor(() => expect(onError).toHaveBeenCalledWith('Send failed'));
  expect(result.current.failedRecording).toBeNull();
  expect(result.current.state).toBe('idle');
});
