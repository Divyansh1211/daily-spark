import { Suspense } from "react";
import { currentUser } from "@/lib/auth";
import { AppShell } from "./app-shell";
import { AuthScreen } from "./auth-screen";

export default function Page() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <Gate />
    </Suspense>
  );
}

/** The app for someone logged in; otherwise the login and sign-up screen. */
async function Gate() {
  const user = await currentUser();
  return user ? <AppShell user={user} /> : <AuthScreen />;
}
