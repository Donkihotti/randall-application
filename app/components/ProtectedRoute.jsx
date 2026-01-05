// components/ProtectedRoute.jsx
"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/*
  Wrap any client page with <ProtectedRoute>...children...</ProtectedRoute>
  and users without a session will be redirected to /signin.
*/

export default function ProtectedRoute({ children, redirectTo = "/signIn" }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function check() {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session ?? null;
        if (!session && mounted) {
          router.replace(redirectTo);
        } else {
          if (mounted) setChecked(true);
        }
      } catch (err) {
        console.error("Auth check failed", err);
        router.replace(redirectTo);
      }
    }
    check();
    return () => { mounted = false; };
  }, [router, redirectTo]);

  if (!checked) {
    return <div className="h-full w-full flex items-center justify-center">Checking session...</div>;
  }
  return <>{children}</>;
}
