import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import { NotesList, RequestNote } from './RequestNotes';

interface FinishTarget {
  _id: string;
  request_code: string;
  issue: string;
  notes?: RequestNote[];
  /** Why an IT admin sent the previous MOV back, if they did. */
  mov_return_reason?: string | null;
}

// The MOV (means of verification): 1-3 photos of the finished work. Same limits as the backend
// (backend-ts/src/utils/movUpload.ts).
const MIN_PHOTOS = 1;
const MAX_PHOTOS = 3;
// Room for full-size phone camera shots; the server shrinks every photo to a small WebP anyway.
const MAX_BYTES = 20 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png'];

interface Photo {
  file: File;
  url: string;
}

/**
 * Finishes an in-progress IT request, used by technicians and by IT admins on requests they took. The
 * photos go with it, and the request waits for an IT admin to verify them before it counts as done.
 */
function FinishRequestModal({ request, onClose, onFinished, onError }: {
  request: FinishTarget;
  onClose: () => void;
  onFinished: () => void;
  onError: (message: string) => void;
}) {
  const [finished, setFinished] = useState('repaired');
  const [remarks, setRemarks] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoError, setPhotoError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Previews are object URLs; release them when the modal closes.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => photosRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const addPhotos = (list: FileList | null) => {
    if (!list) return;
    setPhotoError('');
    const next = [...photos];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_PHOTOS) {
        setPhotoError(`Up to ${MAX_PHOTOS} photos.`);
        break;
      }
      if (!PHOTO_TYPES.includes(file.type)) {
        setPhotoError(`${file.name} is not a JPG or PNG photo.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setPhotoError(`${file.name} is larger than 20 MB.`);
        continue;
      }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    setPhotos(next);
    // Lets the same file be picked again after removing it.
    if (inputRef.current) inputRef.current.value = '';
    if (cameraRef.current) cameraRef.current.value = '';
  };

  const removePhoto = (index: number) => {
    URL.revokeObjectURL(photos[index].url);
    setPhotos(photos.filter((_, i) => i !== index));
    setPhotoError('');
  };

  const handleSubmit = async () => {
    if (photos.length < MIN_PHOTOS) {
      setPhotoError('Attach at least one photo of the finished work.');
      return;
    }
    setSubmitting(true);
    try {
      const body = new FormData();
      body.append('request_id', request._id);
      body.append('finished', finished);
      if (remarks) body.append('remarks', remarks);
      if (recommendation) body.append('recommendation', recommendation);
      photos.forEach((p) => body.append('photos', p.file));
      await api.post('/requests/request_finish', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      onFinished();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string; error?: string } } };
      onError(err.response?.data?.message || err.response?.data?.error || 'Failed to send the request for verification');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal">
      <div className="modal-content">
        <h3>Finish and send MOV</h3>
        <p><strong>Request:</strong> {request.request_code}</p>
        <p><strong>Issue:</strong> {request.issue}</p>
        {request.mov_return_reason && (
          <p className="mov-returned"><strong>Returned by the IT admin:</strong> {request.mov_return_reason}</p>
        )}
        <NotesList notes={request.notes} />

        <div className="form-group">
          <label>Status *</label>
          <select value={finished} onChange={(e) => setFinished(e.target.value)} required>
            <option value="repaired">Repaired</option>
            <option value="beyond repair">Beyond Repair</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="mov-photos">Photos of the finished work (MOV) *</label>
          {/* capture opens the back camera straight away on phones; computers ignore it (the tile is hidden there). */}
          <input
            ref={cameraRef}
            id="mov-camera"
            className="mov-input mov-input-camera"
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            onChange={(e) => addPhotos(e.target.files)}
          />
          <input
            ref={inputRef}
            id="mov-photos"
            className="mov-input mov-input-gallery"
            type="file"
            accept="image/jpeg,image/png"
            multiple
            onChange={(e) => addPhotos(e.target.files)}
          />
          <div className="mov-picker">
            {photos.map((p, i) => (
              <div key={p.url} className="mov-thumb">
                <img src={p.url} alt={`Photo ${i + 1}`} />
                <button type="button" className="mov-remove" onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}>×</button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <>
                <label className="mov-add mov-add-camera" htmlFor="mov-camera">
                  <svg className="mov-add-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  Take photo
                </label>
                <label className="mov-add mov-add-gallery" htmlFor="mov-photos">
                  <span aria-hidden="true">+</span>
                  Choose photo
                </label>
              </>
            )}
          </div>
          {photoError ? <p className="field-error">{photoError}</p> : <p className="mov-help">1 to 3 JPG or PNG photos, up to 20 MB each. An IT admin checks them before the request is marked done.</p>}
        </div>

        <div className="form-group">
          <label>Remarks</label>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} placeholder="Optional" />
        </div>

        <div className="form-group">
          <label>Recommendation</label>
          <textarea value={recommendation} onChange={(e) => setRecommendation(e.target.value)} rows={3} placeholder="Optional" />
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Sending...' : 'Send for verification'}
          </button>
          <button data-modal-dismiss className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default FinishRequestModal;
