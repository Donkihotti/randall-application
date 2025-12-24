import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// NOTE: this handler uses Node fs APIs, so set runtime to nodejs
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const form = await req.formData();
    // `files` is the key we append from the client
    const entries = form.getAll('files'); // array of File objects (web File/Blob)
    if (!entries || entries.length === 0) {
      return NextResponse.json({ ok: false, error: 'No files uploaded' }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await fs.promises.mkdir(uploadDir, { recursive: true });

    const results = [];

    for (const file of entries) {
      // file is a File-like Web API: has .name and .arrayBuffer()
      const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
      const filePath = path.join(uploadDir, filename);
      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.promises.writeFile(filePath, buffer);
      // Publicly accessible from /uploads/<filename> in dev
      results.push({ name: file.name, url: `/uploads/${filename}` });
    }

    return NextResponse.json({ ok: true, files: results });
  } catch (err) {
    console.error('Upload handler error', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
