import fs from 'fs';
import path from 'path';

// Uploads are typed by their extension, not by the MIME type the browser reports: browsers send
// empty or generic types for formats such as .psd, .eps and .tif, which would reject valid files.
// The content is then checked against the signature for that type.
const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ps': 'application/postscript',
  '.eps': 'application/postscript',
  '.psd': 'image/vnd.adobe.photoshop',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
};

export function mimeTypeForFilename(filename: string): string | null {
  return EXTENSION_MIME_TYPES[path.extname(filename).toLowerCase()] || null;
}

// Extensions that map to any of the given MIME types, for error messages and pickers.
export function extensionsForMimeTypes(mimeTypes: string[]): string[] {
  return Object.keys(EXTENSION_MIME_TYPES).filter((ext) => mimeTypes.includes(EXTENSION_MIME_TYPES[ext]));
}

interface Signature {
  offset: number;
  bytes: number[];
}

const sig = (bytes: number[], offset = 0): Signature => ({ offset, bytes });

const MAGIC_SIGNATURES: Record<string, Signature[]> = {
  'application/pdf': [sig([0x25, 0x50, 0x44, 0x46])],
  'image/jpeg': [sig([0xFF, 0xD8, 0xFF])],
  'image/png': [sig([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])],
  'application/msword': [sig([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [sig([0x50, 0x4B, 0x03, 0x04])],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': [sig([0x50, 0x4B, 0x03, 0x04])],
  // MP4 starts with a box-size field whose value varies, then "ftyp" at byte 4.
  'video/mp4': [sig([0x66, 0x74, 0x79, 0x70], 4)],
  'video/webm': [sig([0x1A, 0x45, 0xDF, 0xA3])],
  'application/postscript': [
    sig([0x25, 0x21, 0x50, 0x53]),        // "%!PS" text PostScript / EPS
    sig([0xC5, 0xD0, 0xD3, 0xC6])         // binary EPS with a preview header
  ],
  'image/vnd.adobe.photoshop': [sig([0x38, 0x42, 0x50, 0x53])],
  'image/tiff': [
    sig([0x49, 0x49, 0x2A, 0x00]),
    sig([0x4D, 0x4D, 0x00, 0x2A])
  ]
};

function bufferMatches(buf: Buffer, signature: Signature): boolean {
  if (buf.length < signature.offset + signature.bytes.length) return false;
  return signature.bytes.every((b, i) => buf[signature.offset + i] === b);
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
    return signatures.some(s => bufferMatches(header, s));
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}
