import { describe, it, expect } from 'vitest';
import { isValidSignatureSrc, buildPrincipalSignatureHtml } from '../signatureHelper';
import { removeLightBackgroundFromRgba } from '../storageHelper';

describe('signatureHelper & background transparency', () => {
  it('validates safe signature image URLs and rejects unsafe schemes', () => {
    expect(isValidSignatureSrc('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isValidSignatureSrc('https://cdn.example.com/sig.png')).toBe(true);
    expect(isValidSignatureSrc('/assets/sig.png')).toBe(true);
    expect(isValidSignatureSrc('')).toBe(false);
    expect(isValidSignatureSrc(undefined)).toBe(false);
    expect(isValidSignatureSrc('javascript:alert(1)')).toBe(false);
    expect(isValidSignatureSrc('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('builds safe printable HTML with uploaded signature image or italic fallback', () => {
    const withSig = buildPrincipalSignatureHtml({
      principalSignatureUrl: 'data:image/png;base64,SIG123',
      principalNameEn: 'Amzad Hossain',
    });
    expect(withSig).toContain('<img src="data:image/png;base64,SIG123"');
    expect(withSig).toContain('Amzad Hossain');

    const textOnly = buildPrincipalSignatureHtml({
      principalSignatureUrl: '',
      principalNameEn: 'Amzad <Hossain>',
    });
    expect(textOnly).not.toContain('<img');
    expect(textOnly).toContain('Amzad &lt;Hossain&gt;');

    const empty = buildPrincipalSignatureHtml({});
    expect(empty).toBe('');
  });

  it('makes white paper background transparent while keeping dark ink strokes opaque', () => {
    // 2x2 RGBA buffer: (0,0)=white paper, (1,0)=dark blue ink, (0,1)=white paper, (1,1)=white paper
    const rgba = new Uint8ClampedArray([
      250, 250, 250, 255, // top-left white corner
      15, 35, 110, 255,   // dark blue signature stroke
      245, 245, 245, 255, // bottom-left white
      255, 255, 255, 255, // bottom-right white corner
    ]);

    const changed = removeLightBackgroundFromRgba(rgba, 2, 2);
    expect(changed).toBe(true);
    expect(rgba[3]).toBe(0);    // top-left transparent
    expect(rgba[7]).toBe(255);  // ink pixel preserved opaque
    expect(rgba[11]).toBe(0);   // bottom-left transparent
    expect(rgba[15]).toBe(0);   // bottom-right transparent
  });

  it('skips background stripping when PNG corners are already transparent', () => {
    // 3x3 RGBA buffer: all 4 corners transparent, center pixel (index 4 => byte 16) opaque light gray
    const rgba = new Uint8ClampedArray(3 * 3 * 4);
    rgba[16] = 220;
    rgba[17] = 220;
    rgba[18] = 220;
    rgba[19] = 255;

    const changed = removeLightBackgroundFromRgba(rgba, 3, 3);
    expect(changed).toBe(false);
    expect(rgba[19]).toBe(255); // interior pixel untouched
  });
});
