import { describe, expect, it } from 'vitest';
import { avatarColors, avatarPalette } from './avatar-colors';

function luminance(hex: string) {
  const rgb = hex.slice(1).match(/../g)!.map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

describe('avatar colors', () => {
  it('keeps name colors stable across calls and Unicode representations', () => {
    expect(avatarColors('General')).toEqual(avatarColors('General'));
    expect(avatarColors('Café')).toEqual(avatarColors('Cafe\u0301'));
    expect(avatarColors('')).toHaveProperty('color');
    expect(new Set(['General', 'Ads', 'SEO', 'Mail', 'Review campaign', 'Prepare creatives'].map(name => avatarColors(name).backgroundColor)).size).toBeGreaterThanOrEqual(4);
  });
  it('provides at least 4.5:1 contrast in every theme pair', () => {
    for (const palette of avatarPalette) {
      for (const offset of [0, 2]) {
        const values = [luminance(palette[offset]!), luminance(palette[offset + 1]!)].sort((a, b) => b - a);
        expect((values[0]! + 0.05) / (values[1]! + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
