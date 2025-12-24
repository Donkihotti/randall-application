'use client';

import { useEffect, useRef, useState } from 'react';
import Tools from "./components/Tools"
import DownloadButton from './components/DownloadButton'
import ExpandButton from './components/ExpandButton'
import OptionsButton from './components/OptionsButton'
import NodeCanvas from './components/node/NodeCanvas'
import ImageContainer from './components/ImageContainer'

export default function Page() {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [predictionId, setPredictionId] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [images, setImages] = useState([]);
  const [error, setError] = useState(null);
  const [referenceUrls, setReferenceUrls] = useState([]);
  const pollRef = useRef(null);
  const [mode, setMode] = useState("create"); // 'create'|'generating'|'preview'|'edit'

  const nodeCanvasRef = useRef(null);

  const latest = images.length ? images[images.length - 1] : null;

  const [files, setFiles] = useState([])

  const filesRef = useRef(files);

  //=====Options, aspect_ratio etc.=======

  const panelDefinitions = {
    ratio: {
      label: 'Aspect Ratio',
      defaults: { selected: '9:16' },
      options: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9' ],
      valueKey: 'selected'
    },
    quality: {
      label: 'Quality',
      defaults: { level: 'high' },
      options: ['low', 'medium', 'high'],
    },
    model: {
      label: 'Model',
      defaults: { selected: 'nano-banana-pro' },
      options: ['nano-banana-pro', 'nano-banana', 'seedream 4.0'],
    },
    output: {
      label: 'Output',
      defaults: { selected: 'png' },
      options: ['png', 'jpg', 'jpeg'],
    },
  }

  const [panelValues, setPanelValues] = useState(() => {
    const init = {};
    for (const id in panelDefinitions) {
      init[id] = { ...(panelDefinitions[id].defaults || {}) };
    }
    return init;
  });
  
  // helper to update a single panel value
  const setPanelValue = (panelId, key, value) => {
    setPanelValues(prev => ({
      ...prev,
      [panelId]: { ...(prev[panelId] || {}), [key]: value }
    }));
  };

  //========REFERENCE UPLOAD=========

  const handleFilesAdded = (pickedFiles) => {
    const items = pickedFiles.map((file, i) => {
      const id = crypto.randomUUID()
      const previewUrl = URL.createObjectURL(file)
      return { id, file, previewUrl, name: file.name, size: file.size, status: 'ready' }
    })
    setFiles(prev => [...prev, ...items])
  }

  const removeFile = (id) => {
    setFiles(prev => {
      const toRemove = prev.find(p => p.id === id);
      if (toRemove) {
        URL.revokeObjectURL(toRemove.previewUrl); // free memory
      }
      return prev.filter(p => p.id !== id);
    });
  }

  useEffect(() => { filesRef.current = files }, [files]);

  useEffect(() => {
    return () => {
      // Component unmount: revoke any remaining blob URLs
      filesRef.current.forEach(f => {
        try { URL.revokeObjectURL(f.previewUrl) } catch (e) {}
      });
    };
  }, []);

  //==========OPTIONS===============

  const options = {             
    aspect_ratio: panelValues.ratio?.selected ?? '9:16', 
    quality: panelValues.quality?.level ?? 'medium',  
    output_format: panelValues.output?.selected ?? 'png', 
  }

  //==========PREDICTIONS============

  useEffect(() => {
    // cleanup on unmount
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Utility: consider an id valid only if it's a non-empty string and not literal "undefined"/"null"
function isValidId(id) {
  return typeof id === 'string' && id.trim().length > 0 && id !== 'undefined' && id !== 'null';
}

async function createPrediction(promptText, options = {}) {
  // include references
  const absoluteRefs = referenceUrls.map((u) =>
    u && typeof window !== 'undefined' && u.startsWith('/') ? `${window.location.origin}${u}` : u
  );

  const payload = { 
    prompt: promptText, 
    references: absoluteRefs, 
    options, 
  }

  console.log('Creating prediction — prompt:', promptText, 'references:', absoluteRefs, 'options', options);

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    console.error('Non-JSON create response:', res.status, text);
    throw new Error(`Non-JSON response: ${res.status} — ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  console.log('Create response JSON:', data, 'httpStatus:', res.status);

  if (!res.ok) {
    // show helpful upstream message
    const upstreamMsg = data?.error?.message || data?.error || JSON.stringify(data);
    throw new Error(`Create failed: ${upstreamMsg}`);
  }

  // Common shapes:
  // { id: 'pred_xxx', prediction: {...} }
  // { id: 'pred_xxx' }
  // OR full prediction object at top level (data.id present)
  const id = data?.id || data?.prediction?.id || data?.predictionId || (data?.prediction && data.prediction.id) || null;

  if (isValidId(id)) {
    console.log('Create returned id:', id);
    return { id, raw: data };
  }

  // sometimes server returns a full prediction object (no id at top), accept that as a final prediction
  if (data && (data.status === 'succeeded' || data.status === 'processing' || data.status === 'starting' || data.status === 'failed')) {
    console.log('Create returned a full prediction object (no id). Using rawPrediction directly.', data);
    return { id: null, rawPrediction: data };
  }

  // otherwise bail with a helpful error showing the raw response
  throw new Error(`Create endpoint did not return an id. Response: ${JSON.stringify(data).slice(0, 400)}`);
}

async function fetchPrediction(id) {
  // client-side sanity check
  if (!id || typeof id !== 'string' || id.trim() === '') {
    throw new Error(`fetchPrediction called with invalid id: ${String(id)}`);
  }

  const url = `/api/predictions/${encodeURIComponent(id)}`;
  console.log('Client: polling', url);

  const res = await fetch(url);
  const contentType = res.headers.get('content-type') || '';

  // If server returned non-json (shouldn't with the server fix, but defensive)
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    console.error('Client: polling non-JSON response:', res.status, text.slice(0, 400));
    throw new Error(`Polling non-JSON response (status ${res.status}): ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  console.log('Client: polling JSON response:', { status: res.status, bodyPreview: JSON.stringify(data).slice(0, 600) });

  // If the server proxy flagged an upstream problem, surface that cleanly
  if (!res.ok) {
    // server returns { error, status, upstream?, raw? } per the new server code
    const upstreamMsg = data?.error || data?.upstream || data?.raw || JSON.stringify(data);
    console.error('Client: polling failed, server proxy says:', data);
    throw new Error(`Polling failed: ${upstreamMsg}`);
  }

  // Defensive: if server returned an empty object {} (shouldn't happen now), fail fast with helpful message
  if (!data || (typeof data === 'object' && Object.keys(data).length === 0)) {
    console.error('Client: polling returned empty object — server likely forwarded empty upstream body', data);
    throw new Error('Polling returned empty object — check server logs and upstream response.');
  }

  return data;
}

function startPolling(id) {
  // clear any previous poll
  if (pollRef.current) {
    clearInterval(pollRef.current);
    pollRef.current = null;
  }

  let sawAnyOutput = false;

  pollRef.current = setInterval(async () => {
    try {
      const pred = await fetchPrediction(id);
      // update state
      setPrediction(pred);

      // Extract output images if present
      const out = pred.output || pred.result || pred.images;
      if (out) {
        if (typeof out === 'string') setImages([out]);
        else if (Array.isArray(out)) setImages(out.flat());
        // Mark that we've seen some output so we can update mode to preview
        sawAnyOutput = true;
      }

      // If we just received first partial output, switch to preview mode so UI shows blurred preview
      if (sawAnyOutput && mode !== 'preview' && mode !== 'edit') {
        setMode('preview');
      }

      // stop when finished
      if (pred.status === 'succeeded') {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setGenerating(false);
        setMode('edit'); // final explicit transition
      } else if (pred.status === 'failed') {
        // failed -> go back to create so user can edit/retry
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        setGenerating(false);
        setMode('create');
        setError(pred.error || 'Generation failed');
      }
    } catch (err) {
      console.error('Polling error', err);
      setError(err.message || String(err));
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setGenerating(false);
      // keep user in create so they can try again
      setMode('create');
    }
  }, 1200); // poll every 1.2s
}

async function handleGenerate(e) {
  e?.preventDefault();
  setError(null);
  setImages([]);
  setPrediction(null);

  // UI state
  setGenerating(true);
  setMode('generating'); // explicit transition to generating

  try {
    const create = await createPrediction(prompt, options);

    // If create returned a rawPrediction (no id), use it immediately
    if (create.rawPrediction) {
      const raw = create.rawPrediction;
      setPrediction(raw);
      const out = raw.output || raw.result || raw.images;
      if (out) setImages(Array.isArray(out) ? out.flat() : [out]);
      setGenerating(false);
      setMode('edit'); // we've got a prediction -> go to edit
      return;
    }

    const id = create.id;
    if (!isValidId(id)) {
      console.error('Received invalid id from create:', id, create.raw);
      throw new Error('No valid prediction id returned from create endpoint.');
    }

    setPredictionId(id);
    console.log('Starting polling for id:', id);

    // fetch immediately once and then start polling
    const first = await fetchPrediction(id);
    setPrediction(first);
    const out = first.output || first.result || first.images;
    if (out) setImages(Array.isArray(out) ? out.flat() : [out]);

    // If first response already has output -> preview or done
    if (first.status === 'succeeded') {
      setGenerating(false);
      setMode('edit');
      return;
    }
    if (out && first.status !== 'succeeded') {
      // we have a partial image: show preview while continuing to poll
      setMode('preview');
    } else {
      // no output yet; remain in generating
      setMode('generating');
    }

    startPolling(id);
  } catch (err) {
    console.error('handleGenerate error:', err);
    setError(err.message || String(err));
    setGenerating(false);
    // if create failed, go back to create state so user can edit
    setMode('create');
  }
}

async function handleImageReady(url) {
  setImages((prev) => [...prev, url]);

  // if NodeCanvas mounted, add node; otherwise queue (see below)
  if (nodeCanvasRef.current?.addImageNode) {
    nodeCanvasRef.current.addImageNode({
      image: url,
      prompt, // current prompt variable from your component
      model: panelValues.model?.selected,
    });
  } else {
    // Not mounted yet — you can store in a small queue state and flush in useEffect
    // (see pendingQueue example below)
  }
}

const selectedRatio = panelValues.ratio?.selected ?? '9:16';

  return (
    <div className="page-root bg-bg grid grid-rows-12 grid-cols-12 h-screen">
      <section className='row-span-12 col-span-5 row-start-1 col-start-1 grid grid-cols-5 grid-rows-12 gap-2 p-2'>

        <div className="canvas col-span-5 row-span-8 bg-canvas rounded-md">
          <div className='w-full h-full'>
            <div className='w-full h-full p-2 flex items-center justify-center relative'>
              <div className='absolute top-1 left-2 text-small text-text-white-secondary'>  
                <span>{panelValues.model?.selected + '/ '}{panelValues.ratio?.selected + '/ '}{panelValues.quality?.level + '/'}{panelValues.output.selected}</span>
              </div>
              { mode === 'edit' && 
              <div className='flex flex-row gap-1 absolute top-1 right-1'>
                 <DownloadButton src={latest} filename={`generated-${Date.now()}.png`} className='button-icon z-10'/>
                 <ExpandButton src={latest} alt = 'image' className='button-icon'/>
              </div>
              }
             <ImageContainer aspect={selectedRatio} src={latest} alt="Generated image" />
            </div>
          </div>
        </div>

        <section className='col-span-5 row-span-4 bg-main rounded-md p-2 flex flex-col justify-end relative'>
              <div>
              {mode === 'create' && <Tools onFilesAdded={handleFilesAdded} />}
              </div>
              { mode === 'create' && 
              <OptionsButton
              panelDefinitions={panelDefinitions}
              panelValues={panelValues}
              setPanelValue={setPanelValue}
              /> }
              <form className="" onSubmit={handleGenerate} >
              <div className="flex flex-col gap-3">
                <div className="w-full grid grid-cols-4 gap-x-2">
                </div>

                <div className="rounded-md w-full bg-bg-light p-1.5 drop-shadow-md border-[0.5px] border-border-main h-40 flex flex-col">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={2}
                    className="w-full textarea-default border-none text-medium h-2/3"
                    style={{
                      minHeight: 105,
                      boxSizing: 'border-box',
                      outline: 'none',
                      whiteSpace: 'pre-wrap',
                      wordWrap: 'break-word',
                      color: 'var(--text-light, #e5e7eb)',
                      borderRadius: 8,
                      background: 'transparent',
                    }}
                    placeholder={`Type "/" to open references & models`}
                  />
                 <div className="h-5 w-full"
                  style={{
                    WebkitMaskImage: "linear-gradient(to bottom, black 0%, black 80%, transparent 100%)",
                    maskImage: "linear-gradient(to bottom, black 0%, black 80%, transparent 100%)",
                  }}
                 >
                 </div>

                  <div className="relative h-1/3 w-full flex justify-end">
                    <button type="submit" className="rounded-xs bg-button-create max-h-[34px] px-2.5 py-2 text-black text-medium leading-4 font-medium hover:cursor-pointer disabled:cursor-not-allowed " disabled={generating}>
                     {generating ? 'Generating...' : 'Create'} 
                    </button>
                  </div>
                </div>
              </div>

              {error && <div className="error">{error}</div>}
            </form>
        </section>

      </section>
      <section className='col-span-7 row-span-12 border-l border-border-main'>
        <NodeCanvas ref={nodeCanvasRef} />
      </section>
     
    </div>
  );
}
