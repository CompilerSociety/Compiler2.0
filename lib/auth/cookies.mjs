// lib/auth/cookies.mjs
// Minimal cookie helpers. The app has no cookie dependency, and the surface it
// needs is small: read the request header, and append one Set-Cookie without
// clobbering another set on the same response.

export function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) 
      continue;
    const name = part.slice(0, eq).trim();
    if (!name || Object.prototype.hasOwnProperty.call(out, name)) 
      continue;
    let value = part.slice(eq + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* keep raw */ }
    out[name] = value;
  }
  return out;
}

export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
  // Session and nonce cookies are script-invisible by default.
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  parts.push(`SameSite=${opts.sameSite || 'Lax'}`);
  return parts.join('; ');
}

// Vercel/Node accept an array for Set-Cookie; each call must preserve the ones
// already queued so verify.mjs can set a session and clear the nonce at once.
export function appendSetCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  const list = Array.isArray(existing) ? existing.slice() : existing ? [existing] : [];
  list.push(cookie);
  res.setHeader('Set-Cookie', list);
}
