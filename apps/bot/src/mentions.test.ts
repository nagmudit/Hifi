import { describe, expect, it } from "vitest";

import { botRoleIds, mentionsBot, stripMentions, type MentionInput } from "./mentions.js";

const SELF = "1551246636011880608";
const BOT_ROLE = "1551247238355886164";
const OTHER_ROLE = "999999999999999999";

function input(overrides: Partial<MentionInput> = {}): MentionInput {
  return { selfId: SELF, userMentionIds: [], roleMentions: [], ...overrides };
}

describe("mentionsBot", () => {
  it("accepts a direct user mention", () => {
    expect(mentionsBot(input({ userMentionIds: [SELF] }))).toBe(true);
  });

  it("accepts the bot's own managed role", () => {
    // Discord gives every bot a managed role with the app's name, and offers
    // both it and the user in autocomplete. They look identical when typed.
    expect(mentionsBot(input({ roleMentions: [{ id: BOT_ROLE, botId: SELF }] }))).toBe(true);
  });

  it("ignores an ordinary role the bot happens to hold", () => {
    expect(mentionsBot(input({ roleMentions: [{ id: OTHER_ROLE, botId: null }] }))).toBe(false);
  });

  it("ignores another bot's managed role", () => {
    expect(mentionsBot(input({ roleMentions: [{ id: OTHER_ROLE, botId: "8888" }] }))).toBe(false);
  });

  it("ignores a message mentioning someone else", () => {
    expect(mentionsBot(input({ userMentionIds: ["4242"] }))).toBe(false);
  });

  it("ignores a message with no mentions at all", () => {
    expect(mentionsBot(input())).toBe(false);
  });
});

describe("stripMentions", () => {
  it("removes a user mention and leaves the request", () => {
    expect(stripMentions(`<@${SELF}> fix the typo`, SELF, [])).toBe("fix the typo");
  });

  it("removes the older nickname spelling", () => {
    expect(stripMentions(`<@!${SELF}> fix the typo`, SELF, [])).toBe("fix the typo");
  });

  it("removes a bot role mention, which is what people actually send", () => {
    // Exactly the message that was silently ignored.
    const content = `<@&${BOT_ROLE}>  what's the architecture of the hifi-fixture repo`;
    expect(stripMentions(content, SELF, [BOT_ROLE])).toBe(
      "what's the architecture of the hifi-fixture repo",
    );
  });

  it("leaves mentions of other people intact, since they are part of the request", () => {
    expect(stripMentions(`<@${SELF}> ask <@4242> about this`, SELF, [])).toBe(
      "ask <@4242> about this",
    );
  });

  it("collapses the whitespace a removed mention leaves behind", () => {
    expect(stripMentions(`<@${SELF}>    spaced   out  `, SELF, [])).toBe("spaced out");
  });

  it("returns empty when there is nothing but the mention", () => {
    expect(stripMentions(`<@&${BOT_ROLE}>`, SELF, [BOT_ROLE])).toBe("");
  });
});

describe("botRoleIds", () => {
  it("picks out only this bot's roles", () => {
    const ids = botRoleIds(
      input({
        roleMentions: [
          { id: BOT_ROLE, botId: SELF },
          { id: OTHER_ROLE, botId: null },
        ],
      }),
    );
    expect(ids).toEqual([BOT_ROLE]);
  });
});
