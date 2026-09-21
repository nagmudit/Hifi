/**
 * Working out whether a message is aimed at us.
 *
 * Less obvious than it looks. Discord gives a bot in a server its own managed
 * role with the same name as the app, and the autocomplete offers both the user
 * and that role. They are indistinguishable once typed, but they arrive as
 * different things: `<@id>` lands in the user mentions, `<@&id>` in the role
 * mentions. Accepting only the first silently ignores half of what people type.
 *
 * Pure functions over plain data, so the awkward cases are cheap to test.
 */

export interface RoleMention {
  id: string;
  /** Set when the role is a bot's own managed role. */
  botId: string | null;
}

export interface MentionInput {
  userMentionIds: string[];
  roleMentions: RoleMention[];
  selfId: string;
}

/**
 * True when the bot was addressed directly, either as a user or through its own
 * managed role. Deliberately not true for `@everyone`, or for an ordinary role
 * the bot happens to hold: those are announcements, not requests.
 */
export function mentionsBot(input: MentionInput): boolean {
  if (input.userMentionIds.includes(input.selfId)) return true;
  return input.roleMentions.some((role) => role.botId === input.selfId);
}

/** The role mentions that refer to this bot, whose markup needs stripping too. */
export function botRoleIds(input: MentionInput): string[] {
  return input.roleMentions.filter((r) => r.botId === input.selfId).map((r) => r.id);
}

/**
 * Removes the mention markup so the prompt is what the person actually wrote.
 * Both spellings, because both reach us.
 */
export function stripMentions(content: string, selfId: string, roleIds: string[]): string {
  let out = content.replace(new RegExp(`<@!?${selfId}>`, "g"), " ");
  for (const roleId of roleIds) {
    out = out.replace(new RegExp(`<@&${roleId}>`, "g"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}
