import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Whether this deployment has sign-in turned on, and whether this browser is
 * signed in to it.
 *
 * The workspace needs to know so it can offer a way out. It cannot read
 * `integrations.authEnabled` from the API for this: that reports whether the
 * *server* requires an API key, which is a different switch on a different
 * service, and a deployment can easily have one without the other. Sign-in is
 * the dashboard's own setting, so the dashboard answers for it.
 *
 * Nothing secret is returned. A visitor who is not signed in already knows.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.json({ authEnabled: false, signedIn: false });

  const secret = process.env.AUTH_SECRET || password;
  const user = await verifySessionToken(cookies().get(SESSION_COOKIE)?.value, secret);
  return NextResponse.json({ authEnabled: true, signedIn: Boolean(user), user: user ?? null });
}
