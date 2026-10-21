// Saves one of the request files served by /api/files under a name of our choosing. The server
// names files in its Content-Disposition header, which beats an <a download> name, so the file is
// fetched and saved from memory instead. If that fails it opens in a new tab, where it can still be
// saved by hand.
export async function saveFile(url: string, name: string): Promise<void> {
  try {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(String(res.status));
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}
