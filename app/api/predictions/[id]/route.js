// app/api/predictions/[id]/route.js
import { NextResponse } from 'next/server';

export async function GET(req, context) {
  try {
    // context.params may be a Promise in some Next versions/environments.
    // Safely resolve it if necessary.
    let params = context?.params;
    if (params && typeof params.then === 'function') {
      try {
        params = await params;
      } catch (e) {
        // If awaiting fails, we'll fallback to parsing the URL below.
        console.warn('[predictions proxy] failed to await params:', e);
        params = null;
      }
    }

    // Try to read id from params, else fallback to parsing the pathname
    let id = params?.id ?? null;
    if (!id) {
      try {
        const url = new URL(req.url);
        const parts = url.pathname.split('/').filter(Boolean);
        // last part should be the id for /api/predictions/[id]
        id = parts.length ? parts[parts.length - 1] : null;
      } catch (e) {
        id = null;
      }
    }

    console.log('[predictions proxy] incoming id:', id);

    if (!id) {
      console.warn('[predictions proxy] missing id param');
      return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
    }

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      console.error('[predictions proxy] missing REPLICATE_API_TOKEN');
      return NextResponse.json({ ok: false, error: 'Missing REPLICATE_API_TOKEN' }, { status: 500 });
    }

    const upstreamUrl = `https://api.replicate.com/v1/predictions/${encodeURIComponent(id)}`;

    let resp;
    try {
      resp = await fetch(upstreamUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (fetchErr) {
      console.error(`[predictions proxy] fetch to upstream failed for id=${id}`, fetchErr);
      return NextResponse.json({ ok: false, error: 'Failed to fetch upstream', details: String(fetchErr) }, { status: 502 });
    }

    const status = resp.status;
    const headers = Object.fromEntries(Array.from(resp.headers.entries()).slice(0, 20));
    const text = await resp.text().catch(() => '');

    // server console preview
    console.log(`[predictions proxy] upstream status ${status} for id=${id} bodyPreview:`, text.slice(0, 2000));

    // Try parse JSON
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (e) {
      parsed = null;
    }

    // Construct helpful payload so client never sees an opaque {}
    const payload = {
      ok: resp.ok,
      upstreamStatus: status,
      upstreamHeaders: headers,
      upstreamBodyPreview: text ? text.slice(0, 4000) : null,
      parsedUpstream: parsed,
    };

    if (!resp.ok) {
      return NextResponse.json({ ...payload, error: 'Upstream returned non-OK status' }, { status: 502 });
    }

    if (parsed === null) {
      return NextResponse.json({ ...payload, warning: 'Upstream returned non-JSON or empty body' }, { status: 502 });
    }

    if (typeof parsed === 'object' && Object.keys(parsed).length === 0) {
      return NextResponse.json({ ...payload, warning: 'Upstream returned empty JSON object', upstream: parsed }, { status: 502 });
    }

    // Normal success: forward the parsed prediction object
    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[predictions proxy] unexpected error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
