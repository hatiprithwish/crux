import { describe, it, expect, vi } from "vitest";
import { createVapidJwt, encryptPayload, sendWebPush } from "@/providers/webPush";

function b64uToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToB64u(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jwkFromRawEc(publicBytes: Uint8Array, privateB64u: string) {
  return {
    kty: "EC" as const,
    crv: "P-256" as const,
    x: bytesToB64u(publicBytes.slice(1, 33)),
    y: bytesToB64u(publicBytes.slice(33, 65)),
    d: privateB64u,
    ext: true,
  };
}

// DEV_NOTE: RFC 8291 Appendix A / §5 — verified independently against a from-scratch WebCrypto
// implementation before this file was written (every intermediate value matched, including the
// final concatenated push message body against §5's own worked example), not transcribed on faith.
const VECTOR = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  // header (86 octets) ‖ ciphertext, concatenated as raw bytes then re-base64url'd — NOT the naive
  // string-concatenation of the two base64 strings in Appendix A, which don't share a byte boundary.
  fullBody:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("webPush crypto (RFC 8291 / RFC 8292)", () => {
  it("reproduces the RFC 8291 Appendix A / §5 test vector byte for byte", async () => {
    const asPublicBytes = b64uToBytes(VECTOR.asPublic);
    const asPrivateKey = await crypto.subtle.importKey(
      "jwk",
      jwkFromRawEc(asPublicBytes, VECTOR.asPrivate),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const asPublicKey = await crypto.subtle.importKey(
      "raw",
      asPublicBytes,
      { name: "ECDH", namedCurve: "P-256" },
      true,
      [],
    );

    const body = await encryptPayload({
      plaintext: b64uToBytes(VECTOR.plaintext),
      p256dh: VECTOR.uaPublic,
      auth: VECTOR.authSecret,
      deterministic: {
        salt: b64uToBytes(VECTOR.salt),
        ephemeral: { privateKey: asPrivateKey, publicKey: asPublicKey },
      },
    });

    expect(bytesToB64u(body)).toBe(VECTOR.fullBody);
  });

  it("round trips through a freshly generated UA keypair", async () => {
    const uaKeyPair = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    )) as CryptoKeyPair;
    const uaPublicRaw = new Uint8Array(
      (await crypto.subtle.exportKey("raw", uaKeyPair.publicKey)) as ArrayBuffer,
    );
    const authSecret = crypto.getRandomValues(new Uint8Array(16));
    const plaintext = new TextEncoder().encode("round trip test payload");

    const body = await encryptPayload({
      plaintext,
      p256dh: bytesToB64u(uaPublicRaw),
      auth: bytesToB64u(authSecret),
    });

    // Parse the header back apart exactly as a receiver would, then derive the same CEK/NONCE from
    // the UA's own private key and decrypt — this is the side webPush.ts never implements (only the
    // browser does), so the round trip is worth its own path independent of encryptPayload's internals.
    const salt = body.slice(0, 16);
    const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false);
    const idLen = body[20];
    const asPublicBytes = body.slice(21, 21 + idLen);
    const ciphertext = body.slice(21 + idLen);
    expect(recordSize).toBe(4096);
    expect(idLen).toBe(65);

    const asPublicKey = await crypto.subtle.importKey(
      "raw",
      asPublicBytes,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    // DEV_NOTE: `public`, not workers-types' `$public` — see webPush.ts's EcdhDeriveBitsAlgorithm.
    const ecdhAlgorithm: { name: "ECDH"; public: CryptoKey } = {
      name: "ECDH",
      public: asPublicKey,
    };
    const ecdhSecret = new Uint8Array(
      await crypto.subtle.deriveBits(ecdhAlgorithm, uaKeyPair.privateKey, 256),
    );

    const encoder = new TextEncoder();
    const keyInfo = new Uint8Array([
      ...encoder.encode("WebPush: info"),
      0,
      ...uaPublicRaw,
      ...asPublicBytes,
    ]);
    const ecdhSecretKey = await crypto.subtle.importKey("raw", ecdhSecret, "HKDF", false, [
      "deriveBits",
    ]);
    const ikm = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: authSecret, info: keyInfo },
        ecdhSecretKey,
        32 * 8,
      ),
    );
    const ikmKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    const cek = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt,
          info: new Uint8Array([...encoder.encode("Content-Encoding: aes128gcm"), 0]),
        },
        ikmKey,
        16 * 8,
      ),
    );
    const nonce = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt,
          info: new Uint8Array([...encoder.encode("Content-Encoding: nonce"), 0]),
        },
        ikmKey,
        12 * 8,
      ),
    );

    const cekKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
    const decrypted = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce, tagLength: 128 },
        cekKey,
        ciphertext,
      ),
    );

    // Last byte is the RFC 8188 last-record delimiter (0x02), not part of the plaintext.
    expect(decrypted[decrypted.length - 1]).toBe(2);
    expect(decrypted.slice(0, -1)).toEqual(plaintext);
  });

  it("signs a VAPID JWT that verifies against the public key, with the right claims", async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const publicRaw = new Uint8Array(
      (await crypto.subtle.exportKey("raw", keyPair.publicKey)) as ArrayBuffer,
    );
    const privateJwk = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;

    const nowSeconds = 1_700_000_000;
    const jwt = await createVapidJwt({
      audience: "https://fcm.googleapis.com",
      subject: "mailto:ops@example.com",
      vapid: { publicKey: bytesToB64u(publicRaw), privateKey: privateJwk.d!, subject: "" },
      nowSeconds,
    });

    const [headerB64, payloadB64, signatureB64] = jwt.split(".");
    const header = JSON.parse(new TextDecoder().decode(b64uToBytes(headerB64)));
    const payload = JSON.parse(new TextDecoder().decode(b64uToBytes(payloadB64)));

    expect(header.alg).toBe("ES256");
    expect(payload.aud).toBe("https://fcm.googleapis.com");
    expect(payload.sub).toBe("mailto:ops@example.com");
    expect(payload.exp).toBe(nowSeconds + 12 * 60 * 60);

    // DEV_NOTE: this is what catches the DER-vs-P1363 bug — verify() expects raw r‖s (64 bytes),
    // exactly what WebCrypto's sign() produces and exactly what createVapidJwt must NOT re-encode.
    const signature = b64uToBytes(signatureB64);
    expect(signature.length).toBe(64);
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.publicKey,
      signature,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
    expect(verified).toBe(true);
  });

  it("maps push service response statuses to the right PushSendResult flags", async () => {
    const vapidKeyPair = (await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign"],
    )) as CryptoKeyPair;
    const vapidPublicRaw = new Uint8Array(
      (await crypto.subtle.exportKey("raw", vapidKeyPair.publicKey)) as ArrayBuffer,
    );
    const vapidPrivateJwk = (await crypto.subtle.exportKey(
      "jwk",
      vapidKeyPair.privateKey,
    )) as JsonWebKey;
    const vapid = {
      publicKey: bytesToB64u(vapidPublicRaw),
      privateKey: vapidPrivateJwk.d!,
      subject: "mailto:ops@example.com",
    };

    const target = {
      endpoint: "https://push.example.net/abc",
      p256dh: VECTOR.uaPublic,
      auth: VECTOR.authSecret,
    };

    const cases: Array<
      [number, keyof Omit<Awaited<ReturnType<typeof sendWebPush>>, "status" | "body">]
    > = [
      [201, "isDelivered"],
      [410, "isGone"],
      [403, "isMisconfigured"],
    ];

    for (const [status, flag] of cases) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("", { status }));
      const result = await sendWebPush({ target, payload: "hi", vapid, fetchImpl });
      expect(result.status).toBe(status);
      expect(result[flag]).toBe(true);
    }

    // 429/5xx: transient, nothing is set.
    const transientFetch = vi.fn().mockResolvedValue(new Response("", { status: 429 }));
    const transient = await sendWebPush({
      target,
      payload: "hi",
      vapid,
      fetchImpl: transientFetch,
    });
    expect(transient.isDelivered).toBe(false);
    expect(transient.isGone).toBe(false);
    expect(transient.isMisconfigured).toBe(false);
  });
});
