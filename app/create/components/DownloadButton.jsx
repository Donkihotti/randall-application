// components/DownloadButton.jsx

// A small client-side React component that downloads an image URL.
// Behavior:
//  - Attempts a direct fetch + blob download (fastest)
//  - If direct download fails (CORS/network), falls back to your server proxy at /api/download
//  - Handles data: URLs quickly
//  - Shows a simple downloading state

'use client';
import { useState } from 'react';
import Image from 'next/image';

export default function DownloadButton({
  src,
  filename = 'image.png',
  proxy = '/api/download',
  className = '',
  style = {},
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (!src) {
      alert('No image to download');
      return;
    }

    setDownloading(true);

    try {
      // Quick path for data URLs
      if (src.startsWith('data:')) {
        downloadHref(src, filename);
        return;
      }

      // Try direct fetch first (may fail due to CORS)
      try {
        const res = await fetch(src, { mode: 'cors' });
        if (!res.ok) throw new Error(`Direct fetch failed: ${res.status}`);
        const blob = await res.blob();
        downloadBlob(blob, filename);
        return;
      } catch (directErr) {
        // fallback to proxy
        console.warn('Direct download failed, falling back to proxy:', directErr);
      }

      // Fallback to server proxy
      const proxyUrl = `${proxy}?url=${encodeURIComponent(src)}&filename=${encodeURIComponent(filename)}`;
      const pres = await fetch(proxyUrl);
      if (!pres.ok) {
        // try to extract error message
        let bodyText;
        try {
          bodyText = await pres.text();
        } catch (e) {
          bodyText = String(e);
        }
        throw new Error(`Proxy download failed (${pres.status}): ${bodyText}`);
      }

      const pblob = await pres.blob();
      downloadBlob(pblob, filename);
    } catch (err) {
      console.error('Download error', err);
      // friendly message to user
      alert('Download failed: ' + (err.message || String(err)));
    } finally {
      setDownloading(false);
    }
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function downloadHref(href, name) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className={className}
      style={style}
      aria-busy={downloading}
    >
    <Image 
    src={"/Download.svg"}
    alt={"Download icon"}
    width={18}
    height={18}
    />
    </button>
  );
}


