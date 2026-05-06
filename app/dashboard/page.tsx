import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const nombreComplejo = user.user_metadata?.nombre_complejo ?? user.email;

  return (
    <main className="min-h-screen bg-white px-4 py-8">
      <h1 className="text-2xl font-semibold text-black">{nombreComplejo}</h1>
      <p className="text-sm text-black mt-1">Panel del complejo</p>
    </main>
  );
}
