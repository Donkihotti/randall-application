// app/api/generate/route.js
export const runtime = 'nodejs';

import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

const REPLICATE_FILES_CREATE = 'https://api.replicate.com/v1/files';
const REPLICATE_PREDICTIONS_CREATE = 'https://api.replicate.com/v1/models/google/nano-banana-pro/predictions';

/**
 * Upload a file on disk to Replicate and return the public URL (or id)
 */
async function uploadFileToReplicate(token, filePath) {
  // read file from disk
  const buffer = await fs.promises.readFile(filePath);
  const filename = path.basename(filePath);

  // Node 18+ provides global FormData / Blob
  const form = new FormData();
  const blob = new Blob([buffer]);
  // 'content' is commonly used; Replicate accepts multipart file upload
  form.append('content', blob, filename);

  const resp = await fetch(REPLICATE_FILES_CREATE, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      // DO NOT set Content-Type header; fetch sets the multipart boundary
    },
    body: form,
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(`Replicate file upload failed: ${JSON.stringify(data)}`);
  }

  // Prefer data.urls.get for immediate public URL; fallback to id if needed
  const uploadUrl = data?.urls?.get ?? data?.id ?? null;
  return uploadUrl;
}

/**
 * POST handler — accepts:
 * {
 *   prompt: string,
 *   references?: string[],    // public URLs or relative paths like "/uploads/xxx.png"
 *   options?: { aspectRatio?: string, output?: string, ... }
 * }
 *
 * This endpoint validates options and forwards them as:
 * { input: { prompt, aspect_ratio: "...", output_format: "png", image_input?: [...] } }
 */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { prompt, references = [], options = {} } = body || {};

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    }

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      console.error('REPLICATE_API_TOKEN missing');
      return NextResponse.json({ error: 'Missing REPLICATE_API_TOKEN' }, { status: 500 });
    }

    // === Process references: allow public urls or upload local /... paths ===
    const finalImageInputs = [];

    for (const ref of references || []) {
      if (!ref) continue;

      // public URL
      if (typeof ref === 'string' && (ref.startsWith('http://') || ref.startsWith('https://'))) {
        finalImageInputs.push(ref);
        continue;
      }

      // relative path under public/ (e.g. "/uploads/xxx.png")
      if (typeof ref === 'string' && ref.startsWith('/')) {
        const diskPath = path.join(process.cwd(), 'public', ref.replace(/^\//, ''));
        if (!fs.existsSync(diskPath)) {
          console.warn('Reference file not found on disk:', diskPath);
          continue;
        }
        // upload to Replicate and push returned URL
        const uploadedUrl = await uploadFileToReplicate(token, diskPath);
        if (uploadedUrl) finalImageInputs.push(uploadedUrl);
        continue;
      }

      console.warn('Unknown reference shape, ignoring:', ref);
    }

    // === Options validation & normalization ===
    // Accept keys: options.aspectRatio | options.aspect_ratio | options.aspect
    // Accept output keys: options.output | options.output_format | options.format
    const ALLOWED_OUTPUT = new Set(['png', 'jpg', 'jpeg']);

    const clientAspect =
      (options?.aspectRatio || options?.aspect_ratio || options?.aspect || '4:3').toString();
    const clientOutput =
      (options?.output || options?.output_format || options?.format || 'png').toString().toLowerCase();

    // Validate aspect ratio string e.g. "9:16"
    const isValidRatio = (s) => typeof s === 'string' && /^\d+:\d+$/.test(s.trim());
    const aspectRatio = isValidRatio(clientAspect) ? clientAspect.trim() : '4:3';

    const outputFormat = ALLOWED_OUTPUT.has(clientOutput) ? clientOutput : 'png';

    // === Build the input in the shape nano-banana-pro expects ===
    // Example required shape:
    // const input = { prompt: "...", aspect_ratio: "4:3", output_format: "png" };
    const input = {
      prompt,
      aspect_ratio: aspectRatio,
      output_format: outputFormat,
    };

    if (finalImageInputs.length > 0) {
      input.image_input = finalImageInputs;
    }

    // Debug log (safe during dev)
    console.log('Replicate create payload input:', input);

    // === Create prediction ===
    const resp = await fetch(REPLICATE_PREDICTIONS_CREATE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`, // Replicate uses Bearer for predictions endpoint
      },
      body: JSON.stringify({ input }),
    });

    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      console.error('Replicate create prediction failed', resp.status, data);
      return NextResponse.json({ error: 'Replicate create failed', upstream: data }, { status: 502 });
    }

    // Return id + prediction object so client can poll
    return NextResponse.json({ id: data.id, prediction: data });
  } catch (err) {
    console.error('Generate route error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
