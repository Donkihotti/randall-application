

function UploadReferences({ onUploaded = () => {}, maxFiles = 4, accept = 'image/*', autoUpload = true }) {
    const fileInputRef = useRef(null);
    const [files, setFiles] = useState([]); // { file, previewUrl, name }
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
  
    function openFilePicker() {
      fileInputRef.current?.click();
    }
  
    function handleFilesSelected(fileList) {
      setError(null);
      const arr = Array.from(fileList).slice(0, maxFiles - files.length);
      const mapped = arr.map((f) => ({
        file: f,
        name: f.name,
        previewUrl: URL.createObjectURL(f),
      }));
      const newList = [...files, ...mapped].slice(0, maxFiles);
      setFiles(newList);
  
      if (autoUpload) {
        uploadFiles(newList.map((x) => x.file));
      }
    }
  
    async function uploadFiles(fileObjs) {
      if (!fileObjs || fileObjs.length === 0) return;
      setUploading(true);
      setError(null);
  
      try {
        const fd = new FormData();
        fileObjs.forEach((f) => fd.append('files', f));
  
        const res = await fetch('/api/uploads', {
          method: 'POST',
          body: fd,
        });
  
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const text = await res.text();
          throw new Error(`Upload endpoint did not return JSON: ${text.slice(0, 300)}`);
        }
  
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ? JSON.stringify(data.error) : 'Upload failed');
  
        const urls = (data.files || []).map((f) => f.url);
        onUploaded(urls);
      } catch (err) {
        console.error('Upload error', err);
        setError(err.message || String(err));
      } finally {
        setUploading(false);
      }
    }
  
    function removeIndex(i) {
      const f = files[i];
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      const next = files.slice();
      next.splice(i, 1);
      setFiles(next);
    }
  
    return (
      <div className="upload-root">
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
  
        <div className="controls-upload">
          <button type="button" onClick={openFilePicker} className="btn-upload">
            Add references
          </button>
          <div className="meta">{uploading ? 'Uploading…' : `${files.length}/${maxFiles} selected`}</div>
        </div>
  
        {error && <div className="err">{error}</div>}
  
        <div className="thumbs">
          {files.map((it, i) => (
            <div className="thumb" key={i}>
              <img src={it.previewUrl} alt={it.name} />
              <div className="thumb-meta">
                <div className="name" title={it.name}>
                  {it.name}
                </div>
                <div className="actions">
                  <button type="button" onClick={() => removeIndex(i)} aria-label="Remove">
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
  
        <style jsx>{`
          .upload-root {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          .controls-upload {
            display: flex;
            gap: 12px;
            align-items: center;
          }
          .meta {
            font-size: 13px;
            color: rgba(0, 0, 0, 0.7);
          }
          .err {
            color: #bb3b3b;
            font-size: 13px;
          }
          .thumbs {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-top: 6px;
          }
          .thumb {
            width: 90px;
            border-radius: 8px;
            overflow: hidden;
            background: #fff;
            border: 1px solid rgba(2, 6, 23, 0.06);
          }
          .thumb img {
            width: 100%;
            height: 66px;
            object-fit: cover;
            display: block;
          }
          .thumb-meta {
            display: flex;
            justify-content: space-between;
            padding: 6px;
            font-size: 12px;
            color: #111827;
            background: #f8fafc;
          }
          .thumb .actions button {
            background: transparent;
            border: none;
            color: #111827;
            cursor: pointer;
          }
        `}</style>
      </div>
    );
  }
  