import { useState } from 'react';
import { api } from '../services/api';

interface FileViewerProps {
  files: string[];
  requestId: string;
  type: 'multimedia' | 'digitalmedia' | 'printmaterials';
}

function FileViewer({ files, requestId, type }: FileViewerProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const getFileUrl = (filename: string) => {
    return `/api/files/${type}/${requestId}/${encodeURIComponent(filename)}`;
  };

  const getFileExtension = (filename: string) => {
    const parts = filename.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
  };

  const getFileIcon = (filename: string) => {
    const ext = getFileExtension(filename);
    switch (ext) {
      case 'pdf':
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
        );
      case 'doc':
      case 'docx':
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="M8 13h2" />
            <path d="M8 17h2" />
            <path d="M14 13h2" />
            <path d="M14 17h2" />
          </svg>
        );
      case 'jpg':
      case 'jpeg':
      case 'png':
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        );
      default:
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        );
    }
  };

  const getFileColor = (filename: string) => {
    const ext = getFileExtension(filename);
    switch (ext) {
      case 'pdf':
        return '#e53935';
      case 'doc':
      case 'docx':
        return '#1e88e5';
      case 'jpg':
      case 'jpeg':
      case 'png':
        return '#43a047';
      default:
        return '#757575';
    }
  };

  const getCleanFilename = (filename: string) => {
    const parts = filename.split('-');
    if (parts.length > 1) {
      return parts.slice(1).join('-');
    }
    return filename;
  };

  const handleFileClick = (filename: string) => {
    const ext = getFileExtension(filename);
    const url = getFileUrl(filename);

    if (['jpg', 'jpeg', 'png'].includes(ext)) {
      setPreviewImage(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const handleDownload = (e: React.MouseEvent, filename: string) => {
    e.stopPropagation();
    const url = getFileUrl(filename);
    const link = document.createElement('a');
    link.href = url;
    link.download = getCleanFilename(filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!files || files.length === 0) {
    return <p className="no-files">No files attached</p>;
  }

  return (
    <>
      <div className="file-viewer">
        <div className="file-list">
          {files.map((filename, index) => (
            <div
              key={index}
              className="file-item"
              onClick={() => handleFileClick(filename)}
              style={{ borderLeftColor: getFileColor(filename) }}
            >
              <div className="file-icon" style={{ color: getFileColor(filename) }}>
                {getFileIcon(filename)}
              </div>
              <div className="file-info">
                <span className="file-name">{getCleanFilename(filename)}</span>
                <span className="file-type">{getFileExtension(filename).toUpperCase()}</span>
              </div>
              <div className="file-actions">
                <button
                  className="file-btn download-btn"
                  onClick={(e) => handleDownload(e, filename)}
                  title="Download"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {previewImage && (
        <div className="image-preview-modal" onClick={() => setPreviewImage(null)}>
          <div className="image-preview-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-preview" onClick={() => setPreviewImage(null)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <img src={previewImage} alt="Preview" />
            <div className="preview-actions">
              <button
                className="btn-secondary"
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = previewImage;
                  link.download = previewImage.split('/').pop() || 'image';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
              >
                Download
              </button>
              <button className="btn-secondary" onClick={() => window.open(previewImage, '_blank')}>
                Open in New Tab
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default FileViewer;
