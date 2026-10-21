import { saveFile } from '../lib/download';

// MOV (means of verification) photos of an IT request: what the technician sent when finishing it,
// served by the backend's /api/files/requests route. Each opens full size in a new tab, and has a
// download button that saves it under the request code ("IT-0042-photo-1.webp") rather than the stored name.

export function movPhotoUrl(requestId: string, file: string): string {
  return `/api/files/requests/${requestId}/${encodeURIComponent(file)}`;
}

function downloadName(file: string, index: number, code?: string): string {
  if (!code) return file;
  const dot = file.lastIndexOf('.');
  return `${code}-photo-${index + 1}${dot > 0 ? file.slice(dot) : ''}`;
}

function MovPhotos({ requestId, files, code, heading = 'MOV photos' }: { requestId: string; files?: string[] | null; code?: string; heading?: string }) {
  if (!files || files.length === 0) return null;
  return (
    <div className="mov-photos">
      <h4 className="mov-title">{heading}</h4>
      <div className="mov-grid">
        {files.map((file, i) => (
          <div key={file} className="mov-thumb">
            <a className="mov-open" href={movPhotoUrl(requestId, file)} target="_blank" rel="noopener noreferrer">
              <img src={movPhotoUrl(requestId, file)} alt={`Photo ${i + 1} of the finished work`} loading="lazy" />
            </a>
            <a
              className="mov-download"
              href={movPhotoUrl(requestId, file)}
              download={downloadName(file, i, code)}
              onClick={(e) => { e.preventDefault(); saveFile(e.currentTarget.href, downloadName(file, i, code)); }}
              aria-label={`Download photo ${i + 1}`}
              title="Download"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MovPhotos;
