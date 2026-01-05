// components/auth/AuthForm.jsx
"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export function SignUp({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) return alert(error.message);
    onSuccess?.();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="password" />
      <button disabled={loading} type="submit">Sign up</button>
    </form>
  );
}

export function SignIn({ onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return alert(error.message);
    onSuccess?.();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="password" />
      <button disabled={loading} type="submit">Sign in</button>
    </form>
  );
}

export function SignOutButton() {
  async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }
  return <button onClick={signOut}>Sign out</button>;
}
