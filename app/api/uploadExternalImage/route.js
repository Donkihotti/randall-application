// pages/api/uploadExternalImage.js
import fetch from "node-fetch"; // included in Node; keep for clarity
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("Missing SUPABASE env keys for uploadExternalImage API.");
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });

    // validate token, get user
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) {
      console.error("Auth token invalid", userError);
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    const user = userData.user;

    const { url, projectId } = req.body ?? {};
    if (!url || !projectId) return res.status(400).json({ error: "Missing url or projectId in body" });

    // fetch remote image bytes
    const r = await fetch(url);
    if (!r.ok) {
      return res.status(400).json({ error: `Failed to fetch remote image: ${r.statusText}` });
    }
    const contentType = r.headers.get("content-type") || "application/octet-stream";
    const ext = (contentType.split("/")[1] || "bin").split(";")[0];
    const arrayBuffer = await r.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // build path and upload to storage
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const path = `projects/${projectId}/images/${filename}`;

    // upload with service role (server-only)
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("images")
      .upload(path, buffer, { contentType });

    if (uploadError) {
      console.error("Supabase storage upload error", uploadError);
      return res.status(500).json({ error: uploadError.message || "Upload failed" });
    }

    // create DB metadata row in 'images' table
    const insert = {
      project_id: projectId,
      owner: user.id,
      storage_path: path,
      file_type: contentType,
      metadata: { source_url: url },
    };

    const { data: imageRow, error: insertErr } = await supabaseAdmin
      .from("images")
      .insert([insert])
      .select()
      .single();

    if (insertErr) {
      console.error("Failed to insert image row", insertErr);
      return res.status(500).json({ error: insertErr.message || "DB insert failed" });
    }

    // create a signed URL (valid for 1 hour)
    const { data: signedData, error: signedErr } = await supabaseAdmin.storage
      .from("images")
      .createSignedUrl(path, 60 * 60);

    if (signedErr) {
      // fallback to returning the storage path if signing fails
      console.warn("createSignedUrl failed", signedErr);
      return res.status(200).json({ image: imageRow, signedUrl: null, storagePath: path });
    }

    return res.status(200).json({ image: imageRow, signedUrl: signedData?.signedUrl });
  } catch (err) {
    console.error("uploadExternalImage error", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
