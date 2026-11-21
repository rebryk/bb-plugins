import type { CSSProperties } from 'react';

// Background/ink pairs retain their hue in both themes. Keep this order stable.
export const avatarPalette = [
  ['#bbd9ff', '#173d79', '#28518a', '#e1eeff'],
  ['#cfc3ff', '#49318a', '#58418c', '#f0e8ff'],
  ['#f6bfda', '#79234e', '#873c63', '#ffe8f2'],
  ['#ffc9ae', '#78351c', '#87492f', '#ffebdf'],
  ['#f3db8e', '#624810', '#71591e', '#fff1bf'],
  ['#a9ddc5', '#1d5841', '#29634f', '#d9fff0'],
  ['#a7dfe6', '#175260', '#24616e', '#ddfaff'],
  ['#d3dea0', '#45521b', '#56652b', '#f0f8d3'],
] as const;

export function avatarColors(name: string): CSSProperties {
  let hash = 2166136261;
  for (const character of name.normalize('NFC')) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  }
  const [background, ink, darkBackground, darkInk] = avatarPalette[(hash >>> 0) % avatarPalette.length]!;
  return {
    backgroundColor: `light-dark(${background}, ${darkBackground})`,
    color: `light-dark(${ink}, ${darkInk})`,
  };
}
