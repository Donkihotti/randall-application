// components/ExpandButton.jsx

// Client-side React component that allows expanding an image to fullscreen.
// Behavior:
//  - When clicked, opens a fullscreen overlay (tries real Fullscreen API first, falls back to a fixed-position overlay)
//  - Shows the image centered and scaled to cover/contain depending on `cover` prop
//  - Includes a close (X) button and supports ESC to exit
//  - Click outside the image closes the overlay
//  - Emits optional callbacks onOpen/onClose

'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

export default function ExpandButton({ src, alt = 'image', cover = false, className = '', onOpen, onClose }) {
  const [open, setOpen] = useState(false);
  const overlayRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && open) handleClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    // Sync fullscreenchange -> close when user exits fullscreen manually
    function onFsChange() {
      const isFs = !!document.fullscreenElement;
      if (!isFs && open) {
        // user exited fullscreen by other means -> close overlay state
        setOpen(false);
        onClose?.();
      }
    }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [open, onClose]);

  async function handleOpen() {
    setOpen(true);
    onOpen?.();

    // attempt to use Fullscreen API on the overlay element
    try {
      const el = overlayRef.current;
      if (el && el.requestFullscreen) {
        // request fullscreen; some browsers require user gesture (we are in click handler)
        await el.requestFullscreen();
      }
    } catch (err) {
      // ignore; fallback overlay is already visible
      console.warn('Fullscreen request failed — using in-page overlay as fallback', err);
    }
  }

  async function handleClose() {
    // exit fullscreen if active
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch (err) {
      console.warn('Failed to exit fullscreen', err);
    }
    setOpen(false);
    onClose?.();
  }

  function onOverlayClick(e) {
    // close when clicking the overlay background (but not when clicking the image itself)
    if (e.target === overlayRef.current) {
      handleClose();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={className}
        aria-expanded={open}
        aria-label="Expand image to fullscreen"
      >
         <Image 
            src={"/Expand.svg"}
            alt={"Download icon"}
            width={18}
            height={18}
            />
      </button>

      {open && (
        <div
          ref={overlayRef}
          role="dialog"
          aria-modal="true"
          onClick={onOverlayClick}
          className='bg-main/90'
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div style={{ position: 'relative', maxWidth: '95%', maxHeight: '95%', width: 'auto' }}>
            <img
              ref={imgRef}
              src={src}
              alt={alt}
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: cover ? 'cover' : 'contain',
                borderRadius: 8,
                boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              }}
            />

            <button
              onClick={handleClose}
              aria-label="Close fullscreen"
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'rgba(255,255,255,0.06)',
                color: '#fff',
                border: 'none',
                padding: '6px 8px',
                borderRadius: 6,
                cursor: 'pointer',
                backdropFilter: 'blur(6px)',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
