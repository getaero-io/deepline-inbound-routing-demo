import { NextRequest, NextResponse } from "next/server";

const realm = 'Basic realm="Deepline inbound routing", charset="UTF-8"';

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "www-authenticate": realm },
  });
}

export function proxy(request: NextRequest) {
  const password = process.env.INBOUND_DEMO_ACCESS_PASSWORD;

  // Local development stays frictionless. A production deployment without its
  // access secret fails closed rather than accidentally becoming public.
  if (!password) {
    return process.env.VERCEL_ENV === "production"
      ? new NextResponse("This demo is not configured for public access.", {
          status: 503,
        })
      : NextResponse.next();
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return unauthorized();

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    const username = decoded.slice(0, separator);
    const submittedPassword = decoded.slice(separator + 1);
    if (username === "deepline" && submittedPassword === password)
      return NextResponse.next();
  } catch {
    // Malformed headers receive the same response as incorrect credentials.
  }
  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
