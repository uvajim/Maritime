import { NextRequest, NextResponse } from "next/server";

const FAVICON_LINK = '</favicon.svg>; rel="icon"; type="image/svg+xml"';
function withFavicon(res: NextResponse) {
  res.headers.set("Link", FAVICON_LINK);
  return res;
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  // banking.<domain> — rewrite to /banking/*
  if (host.startsWith("banking.")) {
    const url = request.nextUrl.clone();
    if (!url.pathname.startsWith("/banking")) {
      url.pathname = `/banking${url.pathname === "/" ? "" : url.pathname}`;
    }
    return withFavicon(NextResponse.rewrite(url));
  }

  // No geo-restriction — the app is available worldwide.
  return withFavicon(NextResponse.next());
}

export const config = {
  // Exclude static assets, Next.js internals, and /api/* (proxied to Railway)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff2?)$).*)"],
};
