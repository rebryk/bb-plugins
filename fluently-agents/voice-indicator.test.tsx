// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { VoiceRingProps } from 'voice-ring';
import { VoiceIndicator } from './voice-indicator';

const calls = vi.hoisted(() => ({ props: null as VoiceRingProps | null }));
vi.mock('voice-ring', () => ({ VoiceRing: (props: VoiceRingProps) => { calls.props = props; return <canvas />; } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses the existing recorder level and fixed ring geometry without another audio source', () => {
  const view = render(<VoiceIndicator recording level={0.7} />);
  expect(calls.props).toMatchObject({ type: 'ring', size: 32, state: 'listening', level: 0.7, theme: 'auto', 'aria-hidden': 'true' });
  expect(calls.props?.stream).toBeUndefined();
  expect(calls.props?.analyser).toBeUndefined();
  view.rerender(<VoiceIndicator recording level={0.1} />);
  expect(calls.props?.level).toBe(0.1);
  view.rerender(<VoiceIndicator recording={false} level={0} />);
  expect(calls.props?.state).toBe('processing');
});

it('pauses on reduced motion or a hidden document and removes its listeners on unmount', () => {
  let change!: () => void;
  const motion = { matches: false, addEventListener: vi.fn((_: string, callback: () => void) => { change = callback; }), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => motion);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const remove = vi.spyOn(document, 'removeEventListener');
  const view = render(<VoiceIndicator recording level={0.5} />);
  expect(calls.props?.paused).toBe(false);
  act(() => { motion.matches = true; change(); });
  expect(calls.props?.paused).toBe(true);
  act(() => { motion.matches = false; hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
  expect(calls.props?.paused).toBe(true);
  act(() => { hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); });
  expect(calls.props?.paused).toBe(false);
  view.unmount();
  expect(motion.removeEventListener).toHaveBeenCalledWith('change', change);
  expect(remove).toHaveBeenCalledWith('visibilitychange', change);
});
