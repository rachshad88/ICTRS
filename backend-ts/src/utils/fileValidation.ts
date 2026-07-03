import fs from 'fs';

const MAGIC_SIGNATURES: Record<string, Uint8Array[]> = {
  'application/pdf': [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
  'image/jpeg': [new Uint8Array([0xFF, 0xD8, 0xFF])],
  'image/png': [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  'application/msword': [new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [new Uint8Array([0x50, 0x4B, 0x03, 0x04])],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [new Uint8Array([0x50, 0x4B, 0x03, 0x04])],
  'video/mp4': [new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])],
  'video/webm': [new Uint8Array([0x1A, 0x45, 0xDF, 0xA3])],
  'application/postscript': [new Uint8Array([0x25, 0x21, 0x50, 0x53, 0x2D, 0x41, 0x64, 0x6F, 0x62, 0x65])],
  'image/vnd.adobe.photoshop': [new Uint8Array([0x38, 0x42, 0x50, 0x53])],
  'image/tiff': [
    new Uint8Array([0x49, 0x49, 0x2A, 0x00]),
    new Uint8Array([0x4D, 0x4D, 0x00, 0x2A])
  ]
};

function bufferMatches(buf: Buffer, signature: Uint8Array): boolean {
  if (buf.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buf[i] !== signature[i]) return false;
  }
  return true;
}

export function validateFileMagicBytes(filePath: string, expectedMimeType: string): boolean {
  const signatures = MAGIC_SIGNATURES[expectedMimeType];
  if (!signatures) {
    return true;
  }

  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buf, 0, 16, 0);
    if (bytesRead < 1) return false;

    const header = buf.subarray(0, bytesRead);
    return signatures.some(sig => bufferMatches(header, sig));
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}
