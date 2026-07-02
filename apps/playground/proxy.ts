import { createHash, timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Opt-in HTTP Basic auth for deployed playgrounds (Next 16 proxy file — the
 * successor to middleware.ts; always Node.js runtime).
 *
 * When `PLAYGROUND_BASIC_AUTH` is set (format `user:password`), EVERY route —
 * pages and /api/agents/* alike — requires those credentials. When unset,
 * this is a no-op, so local dev is unaffected. A deployed playground is a
 * credential-bearing control plane; prefer Vercel Deployment Protection as
 * the primary lock, with this as the framework-level fallback.
 */
export default function proxy(request: NextRequest): NextResponse {
  const expected = process.env.PLAYGROUND_BASIC_AUTH;
  if (!expected) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme?.toLowerCase() === "basic" && encoded) {
    const presented = decodeBase64(encoded);
    if (presented !== null && safeEqual(presented, expected)) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    headers: { "www-authenticate": 'Basic realm="Eve Playground"' },
    status: 401,
  });
}

function decodeBase64(encoded: string): string | null {
  try {
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/** Constant-time comparison over fixed-length digests of both sides. */
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}
