import { useEffect, useState, type ImgHTMLAttributes } from 'react';

// Request photos and previews (/api/files/...?size=thumb|preview), kept in memory for the whole visit
// once loaded, so opening the same request's Details again shows them without a new download. The
// server already sends Cache-Control, but browsers don't keep anything from a site whose certificate
// they don't trust, as on the self-signed LAN address. A reload starts the memory cache over.

const MAX_ENTRIES = 150;
const cache = new Map<string, Promise<string>>();

function load(url: string): Promise<string> {
  const hit = cache.get(url);
  if (hit) {
    // Most recently used goes to the end, so the oldest is the one dropped.
    cache.delete(url);
    cache.set(url, hit);
    return hit;
  }
  const p = fetch(url, { credentials: 'same-origin' })
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.blob();
    })
    .then((blob) => URL.createObjectURL(blob));
  // A failed load isn't kept, so the next open tries again.
  p.catch(() => cache.delete(url));
  cache.set(url, p);
  if (cache.size > MAX_ENTRIES) {
    const [oldUrl, oldP] = cache.entries().next().value!;
    cache.delete(oldUrl);
    oldP.then((blobUrl) => URL.revokeObjectURL(blobUrl), () => {});
  }
  return p;
}

/** An <img> whose src is loaded once per visit. If loading fails it falls back to the plain URL. */
function CachedImg({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [shown, setShown] = useState<string | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setShown(undefined);
    load(src).then(
      (blobUrl) => { if (live) setShown(blobUrl); },
      () => { if (live) setShown(src); },
    );
    return () => { live = false; };
  }, [src]);

  return <img src={shown} {...rest} />;
}

export default CachedImg;
