// app/signup/page.jsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSignUp(e) {
    e?.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      // Many apps sign users in automatically; you might want to route to verification or dashboard.
      router.replace("/create");
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto py-12">
      <h1 className="text-2xl mb-4">Create account</h1>
      <form onSubmit={handleSignUp} className="flex flex-col gap-3">
        <input required type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="Email" className="p-2 border rounded" />
        <input required type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="Password" className="p-2 border rounded" />
        <button type="submit" className="bg-green-500 text-white p-2 rounded" disabled={loading}>{loading ? "Creating..." : "Sign up"}</button>
        {err && <div className="text-red-400">{err}</div>}
      </form>

      <div className="mt-4">
        <span>Already have an account? </span>
        <a href="/signIn" className="text-blue-400">Sign in</a>
      </div>
    </div>
  );
}
