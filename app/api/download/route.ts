export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const filename = searchParams.get("filename") ?? "video.mp4";

  if (!url) return new Response("Missing url", { status: 400 });

  const r2Response = await fetch(url);
  if (!r2Response.ok) return new Response("Not found", { status: 404 });

  return new Response(r2Response.body, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
