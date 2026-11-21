import { useEffect, useState } from 'react';
import { VoiceRing } from 'voice-ring';

// Keep the notice in the shipped canvas metadata: BB strips bundle comments.
const license = "voice-ring 0.2.0\nMIT License\n\nCopyright (c) 2026 Jakub Antalik\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n";

/** Decorative only: the existing recorder owns microphone access and levels. */
export function VoiceIndicator({ recording, level }: { recording: boolean; level: number }) {
  const [paused, setPaused] = useState(() => document.hidden || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => setPaused(document.hidden || !!motion?.matches);
    motion?.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      motion?.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return <VoiceRing className="fa-voice-ring" type="ring" size={32}
    state={recording ? 'listening' : 'processing'} level={level}
    theme="auto" paused={paused} aria-hidden="true" data-license={license} />;
}
