// app/signin/page.jsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSignIn(e) {
    e?.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // redirect to dashboard
      router.replace("/dashboard"); 
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="w-screen h-screen grid grid-cols-12 grid-rows-12 bg-white">
     <div className="row-span-12 col-span-6 p-3">
        <div className="w-full h-full rounded-md bg-[url('/sign-in.png')] bg-center bg-cover relative">
            <h2 className="absolute top-6 left-6 text-black font-bold text-medium-plus tracking-tight">Randall</h2>
            <p className="absolute bottom-6 left-6 text-medium-plus font-semibold text-black leading-8">Start creating something <br/> truly amazing.</p>
        </div>
    </div>   
    <div className="px-32 flex flex-col items-center py-12 text-black row-span-12 col-span-6">
    <div className="w-full h-full">
        <h1 className="text-2xl mb-4 text-header-2 font-semibold leading-10">Welcome back</h1>
        <p className="text-text-white-secondary">Sign in to start creating.</p>
        <form onSubmit={handleSignIn} className="flex flex-col gap-3">
            <label className="font-semibold -mb-2">Email</label>
            <input required type="email" value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="johndoe@email.com" className="p-2 border rounded border-text-white-secondary" />
            <label className="font-semibold -mb-2">Password</label>
            <input required type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="password" className="p-2 border rounded border-text-white-secondary" />
            <button type="submit" className="bg-black text-white p-2 rounded mt-8" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
            {err && <div className="text-red-400">{err}</div>}
        </form>

        <div className="mt-4">
            <span>Don't have an account? </span>
            <a href="/signUp" className="text-orange-400 hover:underline">Sign up</a>
        </div>
    </div>
    </div>
    </section>
  );
}
