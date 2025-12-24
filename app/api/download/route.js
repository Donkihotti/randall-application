// app/api/download/route.js
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import url from 'url';

const ALLOWED_HOSTNAMES = new Set([
  'replicate.delivery',
  'cdn.replicate.com',
  'replicate.com',
  'lh3.googleusercontent.com',
  // add other hosts you trust (or allow localhost in dev)
  'localhost',
  '127.0.0.1',
]);

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const rawUrl = searchParams.get('url');
    const filenameParam = searchParams.get('filename') || '';

    if (!rawUrl) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

    // Basic safety: allow only certain hosts
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname;
    if (!ALLOWED_HOSTNAMES.has(hostname)) {
      return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
    }

    // Fetch upstream
    const upstreamRes = await fetch(rawUrl);
    if (!upstreamRes.ok) {
      const txt = await upstreamRes.text().catch(() => '');
      return NextResponse.json({ error: 'Upstream fetch failed', status: upstreamRes.status, raw: txt }, { status: 502 });
    }

    const contentType = upstreamRes.headers.get('content-type') || 'application/octet-stream';
    const extFromType = contentType.split('/')[1] || 'bin';

    // derive filename
    let filename = filenameParam || parsed.pathname.split('/').pop() || `download.${extFromType}`;
    // sanitize filename
    filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');

    const arrayBuffer = await upstreamRes.arrayBuffer();
    const headers = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    };

    return new Response(Buffer.from(arrayBuffer), { status: 200, headers });
  } catch (err) {
    console.error('download proxy error', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
