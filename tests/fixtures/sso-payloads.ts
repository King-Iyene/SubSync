// A test payload generator for the platform's embedded-page user context, and an encryptor that produces the exact
// format the platform sends (CryptoJS AES in OpenSSL "Salted__" form), so tests exercise the real decrypt path.
import { createCipheriv, createHash, randomBytes } from "node:crypto";

export type PayloadInput = {
  type?: unknown; role?: unknown; isAgencyOwner?: unknown; companyId?: unknown; activeLocation?: unknown; userId?: unknown; userName?: unknown;
};

export function makePayload(over: PayloadInput = {}): Record<string, unknown> {
  const base: Record<string, unknown> = { userId: "u-test", companyId: "xtest-co", type: "agency", role: "admin", isAgencyOwner: false, userName: "Test User", email: "test@example.test" };
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) { if (v === undefined) delete out[k]; else out[k] = v; }
  return out;
}

function evpBytesToKey(password: Buffer, salt: Buffer) {
  let derived = Buffer.alloc(0);
  let previous = Buffer.alloc(0);
  while (derived.length < 48) {
    previous = createHash("md5").update(Buffer.concat([previous, password, salt])).digest();
    derived = Buffer.concat([derived, previous]);
  }
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

export function encryptPayload(data: unknown, secret: string): string {
  const salt = randomBytes(8);
  const { key, iv } = evpBytesToKey(Buffer.from(secret, "utf8"), salt);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("Salted__", "latin1"), salt, body]).toString("base64");
}
