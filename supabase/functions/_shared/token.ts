/**
 * The user ID (the "sub" claim) inside a sign-in token, read without
 * checking the token.
 *
 * Only use it to look someone up with that same token, as members.ts does:
 * the database checks the token's signature and refuses a forged one, so a
 * made-up ID gets nothing.
 *
 * Plain TypeScript with no Deno or npm: imports, so supabase/tests can test it.
 */
export function tokenSubject(authorization: string | null): string | null {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]
  const payload = token?.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { sub?: unknown }
    return typeof claims.sub === 'string' && /^[0-9a-f-]{36}$/i.test(claims.sub) ? claims.sub : null
  } catch {
    return null
  }
}
