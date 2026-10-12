// MOV (means of verification) photos of an IT request: what the technician sent when finishing it,
// served by the backend's /api/files/requests route. Each opens full size in a new tab.

export function movPhotoUrl(requestId: string, file: string): string {
  return `/api/files/requests/${requestId}/${encodeURIComponent(file)}`;
}

function MovPhotos({ requestId, files, heading = 'MOV photos' }: { requestId: string; files?: string[] | null; heading?: string }) {
  if (!files || files.length === 0) return null;
  return (
    <div className="mov-photos">
      <h4 className="mov-title">{heading}</h4>
      <div className="mov-grid">
        {files.map((file, i) => (
          <a key={file} className="mov-thumb" href={movPhotoUrl(requestId, file)} target="_blank" rel="noopener noreferrer">
            <img src={movPhotoUrl(requestId, file)} alt={`Photo ${i + 1} of the finished work`} loading="lazy" />
          </a>
        ))}
      </div>
    </div>
  );
}

export default MovPhotos;
