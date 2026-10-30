import { createDecipheriv, createHash } from "node:crypto";

// GHL encrypts the embedded-page user context with CryptoJS.AES.encrypt(json, sharedSecret),
// which is OpenSSL "Salted__" format: base64("Salted__" + 8-byte salt + AES-256-CBC ciphertext),
// with key and IV derived from the passphrase by EVP_BytesToKey (MD5, one iteration).

function evpBytesToKey(password: Buffer, salt: Buffer) {
  const keyLength = 32;
  const ivLength = 16;
  let derived = Buffer.alloc(0);
  let previous = Buffer.alloc(0);
  while (derived.length < keyLength + ivLength) {
    previous = createHash("md5")
      .update(Buffer.concat([previous, password, salt]))
      .digest();
    derived = Buffer.concat([derived, previous]);
  }
  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, keyLength + ivLength),
  };
}

export function decryptSsoPayload(payload: string, sharedSecret: string): unknown {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < 17 || raw.subarray(0, 8).toString("latin1") !== "Salted__") {
    throw new Error("Unexpected SSO payload format");
  }
  const salt = raw.subarray(8, 16);
  const { key, iv } = evpBytesToKey(Buffer.from(sharedSecret, "utf8"), salt);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const text = Buffer.concat([
    decipher.update(raw.subarray(16)),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(text);
}

import { validDomain } from "../links.ts";

export type SsoUser = {
  /** The agency's own domain when it resells the platform under its brand, from the white-label details. */
  whitelabelDomain: string | null;
  userId: string | null;
  companyId: string | null;
  role: string | null;
  type: string | null;
  userName: string | null;
  activeLocation: string | null;
};

// Pick only the fields we use; the raw payload may carry more (email, etc.).
export function parseSsoUser(data: unknown): SsoUser {
  const source = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" && value ? value : null);
  const wl = (source.whitelabelDetails && typeof source.whitelabelDetails === "object" ? source.whitelabelDetails : {}) as Record<string, unknown>;
  return {
    whitelabelDomain: validDomain(wl.domain),
    userId: str(source.userId),
    companyId: str(source.companyId),
    role: str(source.role),
    type: str(source.type),
    userName: str(source.userName),
    activeLocation: str(source.activeLocation),
  };
}
