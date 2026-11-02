// Editable message wording (N79): a title and a body per kind of message, with {variables}. Pure, no database or network.
//
// Safe by construction:
//   - A template is plain text. Angle brackets are refused, so no HTML can reach an email and no Slack mention like <!channel> can be written.
//   - Only the variables the kind offers may be used. An unknown {name} is refused with the list of names that work, never left in the message.
//   - Rendering is ONE pass over the template. A value that happens to contain "{account}" is never expanded again, so data cannot become a template.
//   - Values are cleaned (no angle brackets, no control characters, no line breaks, a length limit) before they are put in.
//   - No code is ever evaluated: the only operation is replacing a known name with its value.

import { CATALOG, type NotificationType, type Variable } from "./catalog.ts";

export const TITLE_MAX = 150;
export const BODY_MAX = 600;
export const VALUE_MAX = 200;

export type Field = "title" | "body";
export type Checked = { ok: true } | { ok: false; error: string };

const TOKEN = /\{([^{}]*)\}/g;
// Anything outside printable text: control characters other than a line break (allowed in the body only).

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// The same set for removing every one of them (a global pattern keeps a position, so it is never used with .test).
const CONTROL_ALL = new RegExp(CONTROL.source, "g");

const names = (vars: Variable[]) => vars.map((v) => `{${v.name}}`).join(", ");

/** Why this text cannot be used as the title or body of a message of this kind, or ok. Throws `Unknown` for an unknown name: use `checkTemplate`. */
function validateTemplate(type: NotificationType, field: Field, text: unknown): Checked {
  if (typeof text !== "string") return { ok: false, error: "The wording must be text." };
  const max = field === "title" ? TITLE_MAX : BODY_MAX;
  if (text.trim().length === 0) return field === "title" ? { ok: false, error: "The title cannot be empty." } : { ok: true };
  if (text.length > max) return { ok: false, error: `The ${field} is ${text.length} characters. The limit is ${max}.` };
  if (/[<>]/.test(text)) return { ok: false, error: "Plain text only: the characters < and > are not allowed." };
  if (CONTROL.test(text)) return { ok: false, error: "The wording has a character that cannot be shown." };
  if (field === "title" && /[\r\n]/.test(text)) return { ok: false, error: "The title must be one line." };
  const vars = CATALOG[type].variables;
  const known = new Set(vars.map((v) => v.name));
  const rest = text.replace(TOKEN, (_m, name: string) => {
    if (!known.has(name.trim()) || name !== name.trim()) throw new Unknown(name);
    return "";
  });
  if (/[{}]/.test(rest)) return { ok: false, error: "A { or } is not part of a {name}. Use a name from the list, for example " + (vars[0] ? `{${vars[0].name}}` : "{account}") + "." };
  return { ok: true };
}

// Not a parameter property: the pure modules also run directly under node's built-in type stripping, which only accepts syntax that is plain types.
class Unknown extends Error {
  field: string;
  constructor(field: string) { super(field); this.field = field; }
}

/** `validateTemplate`, with an unknown name reported in words. */
export function checkTemplate(type: NotificationType, field: Field, text: unknown): Checked {
  try {
    return validateTemplate(type, field, text);
  } catch (e) {
    if (e instanceof Unknown) return { ok: false, error: `{${e.field}} is not a name you can use here. You can use: ${names(CATALOG[type].variables)}.` };
    throw e;
  }
}

/** A value made safe to put in a message: no angle brackets, no control characters, one line, a length limit. */
export function cleanValue(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  const one = s.replace(CONTROL_ALL, "").replace(/[<>]/g, "").replace(/\s*[\r\n]+\s*/g, " ").trim();
  return one.length > VALUE_MAX ? one.slice(0, VALUE_MAX - 1).trimEnd() + "…" : one;
}

/** Put the values into a template in one pass. A name with no value becomes empty text. An unknown name is left out, never expanded from data. */
export function renderTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(TOKEN, (_m, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? cleanValue(values[name]) : "")).replace(/[ \t]{2,}/g, " ").trim();
}

export type Copy = { title: string; body: string };
export type CopyOverride = { title?: string | null; body?: string | null } | null | undefined;

/** The wording in use: the person's own where it is valid, else the default. A saved override that is no longer valid is ignored rather than sent. */
export function resolveCopy(type: NotificationType, override: CopyOverride): Copy {
  const info = CATALOG[type];
  const t = typeof override?.title === "string" && override.title.trim() && checkTemplate(type, "title", override.title).ok ? override.title : info.defaultTitle;
  const b = typeof override?.body === "string" && checkTemplate(type, "body", override.body).ok ? override.body : override?.body === "" ? "" : info.defaultBody;
  return { title: t, body: b };
}

/** The sample values the live preview uses. */
export const sampleValues = (type: NotificationType): Record<string, string> => Object.fromEntries(CATALOG[type].variables.map((v) => [v.name, v.sample]));

/** Render a message of this kind from its wording and values. The wording is trusted only after validation. */
export function renderCopy(type: NotificationType, copy: Copy, values: Record<string, unknown>): Copy {
  return { title: renderTemplate(copy.title, values), body: renderTemplate(copy.body, values) };
}

export type Preview = { ok: true; title: string; body: string } | { ok: false; errors: { title?: string; body?: string } };

/** The live preview: validates what is typed and shows it with sample values. Nothing is saved. */
export function previewCopy(type: NotificationType, input: { title: unknown; body: unknown }): Preview {
  const title = checkTemplate(type, "title", input.title);
  const body = checkTemplate(type, "body", input.body);
  if (!title.ok || !body.ok) return { ok: false, errors: { ...(title.ok ? {} : { title: title.error }), ...(body.ok ? {} : { body: body.error }) } };
  const out = renderCopy(type, { title: input.title as string, body: input.body as string }, sampleValues(type));
  return { ok: true, ...out };
}
