import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// A look at a file picked in the request forms (FileDrop) before it is sent, so the user can check
// it is the right one: clicking a file's card opens it here. Everything is read from the user's own
// device; nothing is uploaded for it. The libraries that read PDFs, Word files and PowerPoints load
// only when such a file is first opened. Old Word .doc files can't be read in a browser, so their
// cards don't open.

type Kind = 'image' | 'video' | 'pdf' | 'docx' | 'pptx';

const KINDS: Record<string, Kind> = {
  jpg: 'image', jpeg: 'image', png: 'image',
  mp4: 'video', webm: 'video',
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
};

const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
const kindOf = (name: string): Kind | undefined => KINDS[extOf(name)];

/** Whether a file of this name can be previewed. */
export const hasPreview = (name: string) => kindOf(name) !== undefined;
/** Whether it is a picture, which the card shows as a small thumbnail. */
export const isImage = (name: string) => kindOf(name) === 'image';

/** A PDF shows this many pages at most: enough to recognise it, without the memory of a long one. */
const MAX_PDF_PAGES = 10;

type Status = 'loading' | 'ready' | 'failed';

/** A blob: URL for the file while it is shown, let go when it is closed, removed or replaced. */
export function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setUrl(null);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** What shows while a file is read, or when it can't be. */
function State({ status, failed }: { status: Status; failed: string }) {
  if (status === 'ready') return null;
  return <p className={`file-preview-state ${status === 'failed' ? 'is-failed' : ''}`}>{status === 'loading' ? 'Loading preview…' : failed}</p>;
}

const DAMAGED = 'This file can’t be previewed. It may be damaged, or not really the type its name says.';

function ImageView({ file }: { file: File }) {
  const url = useObjectUrl(file);
  const [status, setStatus] = useState<Status>('loading');
  return (
    <>
      <State status={status} failed={DAMAGED} />
      {url && <img className="file-preview-media" src={url} alt={file.name} hidden={status !== 'ready'} onLoad={() => setStatus('ready')} onError={() => setStatus('failed')} />}
    </>
  );
}

function VideoView({ file }: { file: File }) {
  const url = useObjectUrl(file);
  const [status, setStatus] = useState<Status>('loading');
  return (
    <>
      <State status={status} failed={`${DAMAGED} Some videos also use a format this browser can’t play.`} />
      {url && (
        <video
          className="file-preview-media"
          // #t: browsers loading only the metadata otherwise show black until Play; this shows its start.
          src={`${url}#t=0.1`}
          controls
          playsInline
          preload="metadata"
          aria-label={file.name}
          hidden={status !== 'ready'}
          onLoadedMetadata={() => setStatus('ready')}
          onError={() => setStatus('failed')}
        />
      )}
    </>
  );
}

/** pdf.js's worker, started with the first PDF and kept for the next. Vite builds it as a plain .js
 * file: the server's types don't list .mjs, and a worker sent under another type won't run. */
let pdfWorker: Promise<void> | null = null;
const startPdfWorker = () =>
  (pdfWorker ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'),
  ]).then(([pdfjs, { default: PdfWorker }]) => {
    pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
  }).catch((e) => {
    pdfWorker = null;
    throw e;
  }));

/** A PDF's pages, drawn one after another by pdf.js (its legacy build also runs in older browsers)
 * at the dialog's width, the first showing as soon as it is ready. */
function PdfView({ file }: { file: File }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    const host = pagesRef.current;
    (async () => {
      const [pdfjs, data] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), file.arrayBuffer(), startPdfWorker()]);
      if (cancelled || !host) return;
      const loading = pdfjs.getDocument({ data: new Uint8Array(data) });
      task = loading;
      const doc = await loading.promise;
      if (cancelled) return;
      setCount(doc.numPages);
      const width = host.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      for (let n = 1; n <= Math.min(doc.numPages, MAX_PDF_PAGES); n++) {
        const page = await doc.getPage(n);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: (width * dpr) / page.getViewport({ scale: 1 }).width });
        const canvas = document.createElement('canvas');
        canvas.className = 'file-preview-page';
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `Page ${n} of ${file.name}`);
        await page.render({ canvas, viewport }).promise;
        if (cancelled) return;
        host.append(canvas);
        if (n === 1) setStatus('ready');
      }
    })().catch(() => {
      if (!cancelled) setStatus('failed');
    });
    return () => {
      cancelled = true;
      task?.destroy();
      host?.replaceChildren();
    };
  }, [file]);
  return (
    <>
      <State status={status} failed={DAMAGED} />
      <div ref={pagesRef} className="file-preview-pages" />
      {status === 'ready' && count > MAX_PDF_PAGES && (
        <p className="file-preview-state">Showing the first {MAX_PDF_PAGES} of {count} pages.</p>
      )}
    </>
  );
}

/** A Word document laid out page by page by docx-preview, shrunk to the dialog's width. */
function DocxView({ file }: { file: File }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  useEffect(() => {
    let cancelled = false;
    const frame = frameRef.current;
    const host = hostRef.current;
    // Laid out (it is measured) but not seen until it is scaled.
    if (frame) frame.style.height = '0px';
    (async () => {
      const { renderAsync } = await import('docx-preview');
      if (cancelled || !frame || !host) return;
      await renderAsync(file, host, undefined, {
        inWrapper: false,
        // Embedded fonts arrive as data: fonts, which the site's security policy doesn't load.
        ignoreFonts: true,
        useBase64URL: true,
        renderComments: false,
        renderChanges: false,
      });
      if (cancelled) return;
      const page = host.querySelector<HTMLElement>('section.docx');
      if (!page) throw new Error('No page');
      // Scaled, not reflowed, so it looks as it will print; the frame takes the scaled size.
      const scale = Math.min(1, frame.clientWidth / page.offsetWidth);
      host.style.transform = `scale(${scale})`;
      host.style.width = `${page.offsetWidth}px`;
      frame.style.height = `${host.offsetHeight * scale}px`;
      setStatus('ready');
    })().catch(() => {
      if (!cancelled) setStatus('failed');
    });
    return () => {
      cancelled = true;
      host?.replaceChildren();
    };
  }, [file]);
  return (
    <>
      <State status={status} failed={DAMAGED} />
      <div ref={frameRef} className="file-preview-docx">
        <div ref={hostRef} className="file-preview-docx-body" />
      </div>
    </>
  );
}

/** A PowerPoint's first slide: the picture of it PowerPoint saves inside the file. */
function PptxView({ file }: { file: File }) {
  const [thumb, setThumb] = useState<Blob | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const url = useObjectUrl(thumb);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file);
      const entry = zip.file(/^docProps\/thumbnail\.(jpe?g|png)$/i)[0];
      if (!entry) throw new Error('No thumbnail');
      const type = entry.name.toLowerCase().endsWith('png') ? 'image/png' : 'image/jpeg';
      const blob = new Blob([await entry.async('arraybuffer')], { type });
      if (!cancelled) setThumb(blob);
    })().catch(() => {
      if (!cancelled) setStatus('failed');
    });
    return () => {
      cancelled = true;
    };
  }, [file]);
  return (
    <>
      <State
        status={status}
        failed="This presentation has no saved picture of its first slide to show. Files saved by PowerPoint have one; some other programs leave it out."
      />
      {url && <img className="file-preview-media file-preview-page" src={url} alt={`First slide of ${file.name}`} hidden={status !== 'ready'} onLoad={() => setStatus('ready')} onError={() => setStatus('failed')} />}
      {status === 'ready' && <p className="file-preview-state">The first slide.</p>}
    </>
  );
}

function View({ file }: { file: File }) {
  switch (kindOf(file.name)) {
    case 'image': return <ImageView file={file} />;
    case 'video': return <VideoView file={file} />;
    case 'pdf': return <PdfView file={file} />;
    case 'docx': return <DocxView file={file} />;
    case 'pptx': return <PptxView file={file} />;
    default: return null;
  }
}

/**
 * The dialog showing a picked file. Escape or Close shuts it (useModalEscape in App.tsx presses
 * data-modal-dismiss); Remove takes the file off the request, for when it was the wrong one.
 * Placed in .app-main, outside the form and its field styles, as the app's other dialogs are.
 */
export function FilePreviewDialog({ file, size, onClose, onRemove }: { file: File; size: ReactNode; onClose: () => void; onRemove: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  const dialog = (
    <div className="modal file-preview-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content file-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="file-preview-title">
        <div className="modal-header">
          <div className="file-preview-heading">
            <h3 id="file-preview-title" title={file.name}>{file.name}</h3>
            <span className="file-preview-size">{size}</span>
          </div>
          <button ref={closeRef} type="button" className="modal-close" data-modal-dismiss onClick={onClose} aria-label="Close preview">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="file-preview-body">
          <View file={file} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onRemove}>Remove file</button>
          <button type="button" className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
  return createPortal(dialog, document.querySelector('.app-main') ?? document.body);
}
