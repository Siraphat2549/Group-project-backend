import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { basename, join, resolve } from 'path';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_FIELD = 'image';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
export const ALLOWED_IMAGE_MIME = Object.keys(EXT_BY_MIME);

/**
 * Detects the real image type from the file's magic bytes instead of
 * trusting the client-supplied Content-Type / file name.
 */
export function detectImageMime(buf: Buffer): string | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return undefined;
}

export class RoomImageStorage {
  private readonly dir: string;

  constructor(uploadRoot: string) {
    this.dir = resolve(uploadRoot, 'rooms');
  }

  /** Writes the file under a random name; returns name + public URL path. */
  async save(
    buf: Buffer,
    mime: string,
  ): Promise<{ fileName: string; url: string }> {
    await mkdir(this.dir, { recursive: true });
    const fileName = `${randomUUID()}.${EXT_BY_MIME[mime]}`;
    await writeFile(join(this.dir, fileName), buf);
    return { fileName, url: `/uploads/rooms/${fileName}` };
  }

  /** Best-effort delete; a missing file is not an error. */
  async remove(fileName: string | null | undefined): Promise<void> {
    if (!fileName) return;
    // basename() guards against path traversal from a tampered DB value.
    await unlink(join(this.dir, basename(fileName))).catch(() => undefined);
  }
}
