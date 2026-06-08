"use server";

import { createAdminClient } from "@/utils/supabase/admin";
import { revalidatePath } from "next/cache";

export async function agregarCancha(formData: FormData) {
  const supabase = createAdminClient();
  const nombre = formData.get("nombre") as string;
  const complejo_id = formData.get("complejo_id") as string;

  await supabase.from("canchas").insert({ nombre, complejo_id });
  revalidatePath("/admin");
}

export async function eliminarCancha(formData: FormData) {
  const supabase = createAdminClient();
  const id = formData.get("id") as string;

  await supabase.from("canchas").delete().eq("id", id);
  revalidatePath("/admin");
}

export async function cambiarPassword(formData: FormData) {
  const supabase = createAdminClient();
  const user_id = formData.get("user_id") as string;
  const password = formData.get("password") as string;

  await supabase.auth.admin.updateUserById(user_id, { password });
  revalidatePath("/admin");
}
