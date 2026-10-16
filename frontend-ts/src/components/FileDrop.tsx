import { useId, useRef, useState, type DragEvent } from 'react';

// The file field of the request forms, in place of the browser's "Choose File / No file chosen"
// box: a drop zone that opens the file picker on a click or tap and takes files dragged onto it,
// and the picked files as cards that can be removed. Each file is checked as it is added, against
// the same rules as the server (backend-ts/src/routes/multimediaFactory.ts): its type by extension
// and 10 MB, so a wrong file is caught here instead of failing the whole request on submit.
// The picker window itself is the computer's or phone's own and can't be restyled.

const MB = 1024 * 1024;

export const fileSize = (bytes: number) =>
  bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

const UploadIcon = () => (
  <svg className="file-drop-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
    <path d="M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3" />
  </svg>
);

function FileDrop({ label, files, onChange, accept, multiple = false, maxFiles = multiple ? 10 : 1, maxBytes = 10 * MB, hint }: {
  label: string;
  files: File[];
  onChange: (files: File[]) => void;
  /** Allowed extensions, as for <input accept>: ".pdf,.jpg,..." */
  accept: string;
  multiple?: boolean;
  maxFiles?: number;
  maxBytes?: number;
  /** What may be uploaded, shown under the zone. */
  hint: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const allowed = accept.split(',').map((e) => e.trim().replace(/^\./, '').toLowerCase());

  const add = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const problems: string[] = [];
    // One file: a new pick replaces it. Several: picks add up, to the limit. A rejected pick leaves
    // what is attached as it was.
    let next = [...files];
    for (const file of Array.from(list)) {
      if (!allowed.includes(extOf(file.name))) {
        problems.push(`${file.name} is not an allowed file type.`);
      } else if (file.size > maxBytes) {
        problems.push(`${file.name} is larger than ${maxBytes / MB} MB.`);
      } else if (!multiple) {
        next = [file];
      } else if (next.some((f) => sameFile(f, file))) {
        // Already attached.
      } else if (next.length >= maxFiles) {
        problems.push(`Up to ${maxFiles} files. ${file.name} was not added.`);
      } else {
        next.push(file);
      }
    }
    setErrors(problems);
    onChange(next);
    // Lets the same file be picked again after removing it.
    if (input.current) input.current.value = '';
  };

  const remove = (i: number) => {
    setErrors([]);
    onChange(files.filter((_, k) => k !== i));
    input.current?.focus();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };

  const full = files.length >= maxFiles;
  const zoneText = !multiple && files.length ? 'Replace file' : files.length ? 'Add more files' : multiple ? 'Add files' : 'Add a file';

  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        ref={input}
        id={id}
        className="file-drop-input"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={multiple && full}
        onChange={(e) => add(e.target.files)}
      />
      {!(multiple && full) && (
        <label
          htmlFor={id}
          className={`file-drop ${over ? 'is-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <UploadIcon />
          <span className="file-drop-text">
            <span className="file-drop-title">{zoneText}</span>
            <span className="file-drop-sub file-drop-sub-pointer">Drop here or <u>browse</u></span>
            <span className="file-drop-sub file-drop-sub-touch">Tap to choose</span>
          </span>
        </label>
      )}
      {files.length > 0 && (
        <ul className="file-cards" aria-label="Attached files">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${f.lastModified}`} className="file-card">
              <span className="file-card-ext" aria-hidden="true">{extOf(f.name).slice(0, 4) || 'FILE'}</span>
              <span className="file-card-text">
                <span className="file-card-name" title={f.name}>{f.name}</span>
                <span className="file-card-size">{fileSize(f.size)}</span>
              </span>
              <button type="button" className="file-card-remove" onClick={() => remove(i)} aria-label={`Remove ${f.name}`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      {errors.map((e) => <p key={e} className="field-error" role="alert">{e}</p>)}
      <small>{multiple ? `${files.length} of ${maxFiles} files. ` : ''}{hint}</small>
    </>
  );
}

export default FileDrop;
