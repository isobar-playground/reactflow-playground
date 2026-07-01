import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, createSessionToken } from "@/lib/auth-gate";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session-cookie";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");

  if (!(await verifyPassword(password))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?error=1";
    return NextResponse.redirect(url, { status: 303 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
