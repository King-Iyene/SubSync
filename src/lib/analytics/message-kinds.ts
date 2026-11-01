// What kind of entry in a conversation a message type is. Pure. Used by every metric that asks "did someone reply?" (INTEGRATIONS_SPEC section 10,
// CLAUDE.md principle 14).
//
// An internal comment is a note the team writes to itself inside the contact's conversation. The platform stores it as an OUTBOUND message of type
// InternalComment (its webhook says `messageType: InternalComment`; a conversation list may say TYPE_INTERNAL_COMMENT, CHECK which). It is never
// sent to the contact, so it is never a reply, never a touch, and never a sign that the customer was answered. This matters most for the comments
// SubSync itself writes: without this guard our own comment could make a waiting lead look answered.

/** True for an internal comment, whichever way the platform spells it. */
export const isInternalComment = (type: string | null | undefined): boolean => /internal[\s_-]?comment/i.test(type ?? "");

/** A message that was sent to, or received from, the customer. Internal comments are not. */
export const isCustomerFacing = (type: string | null | undefined): boolean => !isInternalComment(type);
