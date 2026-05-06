import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const rutasProtegidas = ["/dashboard", "/mis-partidos"];
const rutasAuth = ["/login", "/registro"];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Sin sesión intentando acceder a ruta protegida → login
  if (!user && rutasProtegidas.some((r) => path.startsWith(r))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Con sesión intentando ir a login/registro → redirigir según rol
  if (user && rutasAuth.includes(path)) {
    const role = user.user_metadata?.role;
    return NextResponse.redirect(
      new URL(role === "club" ? "/dashboard" : "/mis-partidos", request.url)
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
