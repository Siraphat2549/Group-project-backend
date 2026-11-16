import { detectImageMime } from './room-image.storage';

describe('detectImageMime', () => {
  it('detects JPEG, PNG and WebP by magic bytes', () => {
    expect(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe(
      'image/jpeg',
    );
    expect(
      detectImageMime(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ),
    ).toBe('image/png');
    expect(detectImageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe(
      'image/webp',
    );
  });

  it('rejects anything else, whatever the client claims', () => {
    expect(detectImageMime(Buffer.from('<svg onload="alert(1)">'))).toBe(
      undefined,
    );
    expect(detectImageMime(Buffer.from('GIF89a'))).toBe(undefined);
    expect(detectImageMime(Buffer.alloc(0))).toBe(undefined);
  });
});
