import { NextRequest, NextResponse } from "next/server";
import { gateDecision } from "@/lib/gate-decision";
import { isValidSessionToken, isGateDisabled } from "@/lib/auth-gate";
import { SESSION_COOKIE } from "@/lib/session-cookie";

export async function proxy(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? "";
  const authenticated =
    isGateDisabled() || (token ? await isValidSessionToken(token) : false);

  switch (gateDecision(req.nextUrl.pathname, authenticated)) {
    case "allow":
      return NextResponse.next();
    case "unauthorized":
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    case "redirect": {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }
}

// Run on everything except Next internals and static files.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.\\w+$).*)"],
};
