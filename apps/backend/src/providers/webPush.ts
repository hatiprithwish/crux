// DEV_NOTE: sits with clerk.ts and logger.ts as a protocol adapter. Imports no DAL, no Repo, does no
// logging, throws nothing — pruning a dead subscription is the Repo's decision, made from the
// PushSendResult this returns. Every intermediate value here is verified byte-for-byte against
// RFC 8291 Appendix A's test vector in webPush.test.ts — a subtly wrong HKDF `info` string or a
// DER-wrapped signature produces a request the push service answers 201 to and the browser silently
// discards, so nothing in this file is "probably right".

export interface VapidKeys {
  // Raw uncompressed P-256 point (65 bytes), base64url — env.VAPID_PUBLIC_KEY as generated.
  publicKey: string;
  // The JWK `d` component (32 bytes), base64url — env.VAPID_PRIVATE_KEY as generated.
  privateKey: string;
  subject: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  status: number;
  isDelivered: boolean;
  isGone: boolean;
  isMisconfigured: boolean;
  body?: string;
}

// DEV_NOTE: the real deriveBits() shape for ECDH, per the WebCrypto spec and confirmed empirically
// against workerd — @cloudflare/workers-types v4.20260517.1's SubtleCryptoDeriveKeyAlgorithm names
// this member `$public`, but that's a types bug: passing `$public` throws `Missing field "public"
// in "derivedKeyParams"` at runtime. Declared locally so the correct call site needs no `any`.
interface EcdhDeriveBitsAlgorithm {
  name: "ECDH";
  public: CryptoKey;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// DEV_NOTE: JWK, not pkcs8 — reconstructed from both the public and private halves, which is why
// VapidKeys carries both at runtime rather than deriving the public key from the private one.
async function importVapidPrivateKey(vapid: VapidKeys, keyUsage: "sign"): Promise<CryptoKey> {
  const publicBytes = base64UrlDecode(vapid.publicKey);
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: vapid.privateKey,
      x: base64UrlEncode(publicBytes.slice(1, 33)),
      y: base64UrlEncode(publicBytes.slice(33, 65)),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    [keyUsage],
  );
}

// DEV_NOTE: RFC 8292 (VAPID), ES256. WebCrypto's ECDSA sign returns raw r‖s (IEEE P1363, 64 bytes),
// which IS the JOSE signature format already — do NOT DER-unwrap it. That is the classic bug here,
// and it surfaces as a 401 you spend an afternoon on.
export async function createVapidJwt(params: {
  audience: string;
  subject: string;
  vapid: VapidKeys;
  nowSeconds?: number;
}): Promise<string> {
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", typ: "JWT" };
  const payload = { aud: params.audience, exp: now + 12 * 60 * 60, sub: params.subject };

  const encoder = new TextEncoder();
  const signingInput = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(
    encoder.encode(JSON.stringify(payload)),
  )}`;

  const privateKey = await importVapidPrivateKey(params.vapid, "sign");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    encoder.encode(signingInput),
  );

  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

// DEV_NOTE: RFC 8291 (aes128gcm). Returns the full push message body — the 86-octet content coding
// header (salt ‖ record size ‖ keyid length ‖ application-server public key) concatenated with the
// AES-128-GCM ciphertext — exactly what RFC 8291 §5 shows as the HTTP request body.
export async function encryptPayload(params: {
  plaintext: Uint8Array;
  p256dh: string;
  auth: string;
  // Injectable ONLY so the RFC 8291 §5 vector reproduces bit for bit. Never passed in production —
  // a reused salt or ephemeral key is a real cryptographic break.
  deterministic?: { salt: Uint8Array; ephemeral: CryptoKeyPair };
}): Promise<Uint8Array> {
  const salt = params.deterministic?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const ephemeral =
    params.deterministic?.ephemeral ??
    ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair);

  const uaPublicBytes = base64UrlDecode(params.p256dh);
  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublicBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const asPublicBytes = new Uint8Array(
    (await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer,
  );

  // DEV_NOTE: @cloudflare/workers-types v4.20260517.1 declares this dictionary member as `$public`
  // (SubtleCryptoDeriveKeyAlgorithm), but the real workerd runtime wants the spec-correct `public` —
  // confirmed empirically: passing `$public` throws `Missing field "public" in "derivedKeyParams"`
  // at runtime, and `deriveBitsAlgorithm` below is typed loosely to work around what looks like an
  // upstream types bug rather than a real error in this call.
  const deriveBitsAlgorithm: EcdhDeriveBitsAlgorithm = { name: "ECDH", public: uaPublicKey };
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(deriveBitsAlgorithm, ephemeral.privateKey, 256),
  );

  const encoder = new TextEncoder();
  // key_info = "WebPush: info" || 0x00 || ua_public || as_public — RFC 8291 §3.3.
  const keyInfo = concatBytes(
    encoder.encode("WebPush: info"),
    new Uint8Array([0]),
    uaPublicBytes,
    asPublicBytes,
  );

  const authSecret = base64UrlDecode(params.auth);
  const ecdhSecretKey = await crypto.subtle.importKey("raw", ecdhSecret, "HKDF", false, [
    "deriveBits",
  ]);
  // DEV_NOTE: WebCrypto's HKDF does extract+expand in one deriveBits call, exactly as RFC 5869 (and
  // RFC 8291 §3.3's HKDF-Extract/HKDF-Expand pseudocode) specifies.
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: authSecret, info: keyInfo },
      ecdhSecretKey,
      32 * 8,
    ),
  );

  const ikmKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const cekInfo = concatBytes(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0]));
  const cek = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: cekInfo },
      ikmKey,
      16 * 8,
    ),
  );
  const nonceInfo = concatBytes(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0]));
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: nonceInfo },
      ikmKey,
      12 * 8,
    ),
  );

  // DEV_NOTE: RFC 8188's last-record delimiter — 0x02, not 0x01 (which marks a non-final record).
  // A web push message is always exactly one record (RFC 8291 §4).
  const padded = concatBytes(params.plaintext, new Uint8Array([2]));
  const cekKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cekKey, padded),
  );

  // header = salt(16) ‖ rs(4, uint32 BE 4096) ‖ idlen(1 = 65) ‖ asPublic(65) — RFC 8188 §2.1.
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, recordSize, new Uint8Array([65]), asPublicBytes);

  return concatBytes(header, ciphertext);
}

// DEV_NOTE: status mapping is the caller's contract — 404/410 mean the push service has permanently
// discarded the subscription (the caller soft-deletes); 400/401/403 mean OUR request was malformed
// or our VAPID key is wrong, logged at error and NEVER pruned (a bad key deploy would otherwise wipe
// every subscription in the table on its first send); 429/5xx are transient and the row is untouched.
export async function sendWebPush(params: {
  target: PushTarget;
  payload: string;
  vapid: VapidKeys;
  ttlSeconds?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  fetchImpl?: typeof fetch;
}): Promise<PushSendResult> {
  const fetchFn = params.fetchImpl ?? fetch;

  const body = await encryptPayload({
    plaintext: new TextEncoder().encode(params.payload),
    p256dh: params.target.p256dh,
    auth: params.target.auth,
  });

  const audience = new URL(params.target.endpoint).origin;
  const jwt = await createVapidJwt({
    audience,
    subject: params.vapid.subject,
    vapid: params.vapid,
  });

  const res = await fetchFn(params.target.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${params.vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(params.ttlSeconds ?? 86400),
      Urgency: params.urgency ?? "normal",
    },
    body: body as BodyInit,
  });

  const result: PushSendResult = {
    status: res.status,
    isDelivered: false,
    isGone: false,
    isMisconfigured: false,
  };

  if (res.status === 200 || res.status === 201) {
    result.isDelivered = true;
  } else if (res.status === 404 || res.status === 410) {
    result.isGone = true;
    result.body = await res.text().catch(() => undefined);
  } else if (res.status === 400 || res.status === 401 || res.status === 403) {
    result.isMisconfigured = true;
    result.body = await res.text().catch(() => undefined);
  } else {
    result.body = await res.text().catch(() => undefined);
  }

  return result;
}
