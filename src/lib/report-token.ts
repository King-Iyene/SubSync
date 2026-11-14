import { randomBytes } from "node:crypto";

/** A share link's id: 24 random bytes (192 bits) written as 32 URL-safe characters. Server only. */
export const newReportToken = () => randomBytes(24).toString("base64url");
