import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");
  if (user.user_metadata?.role !== "club") redirect("/mis-partidos");

  return (
    <main className="min-h-screen bg-white px-4 py-8">
      <h1 className="text-2xl font-semibold text-black">Panel del club</h1>
      <p className="text-black mt-2 text-sm">{user.email}</p>
    </main>
  );
}
