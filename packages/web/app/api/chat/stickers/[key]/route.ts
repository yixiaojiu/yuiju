import { fetchWebChatSticker } from "@/lib/message-internal-api";
import { isPublicDeployment } from "@/lib/public-deployment";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
  if (isPublicDeployment()) {
    return new Response(null, { status: 404 });
  }

  const { key } = await context.params;

  try {
    const internalResponse = await fetchWebChatSticker(key);
    if (internalResponse.status === 404) {
      return new Response(null, { status: 404 });
    }
    if (!internalResponse.ok) {
      return new Response(null, { status: 502 });
    }

    const contentType = internalResponse.headers.get("content-type");
    if (!contentType) {
      return new Response(null, { status: 502 });
    }

    return new Response(internalResponse.body, {
      headers: {
        "Cache-Control": "private, max-age=86400",
        "Content-Type": contentType,
      },
    });
  } catch (error) {
    console.error("Web chat sticker internal API request failed", error);
    return new Response(null, { status: 502 });
  }
}
