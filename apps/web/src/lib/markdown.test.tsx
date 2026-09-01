// @vitest-environment happy-dom
/**
 * Shortcode rendering, and the three ways it could quietly go wrong.
 *
 * The security property is the one worth pinning: an `<img>` appears only when the name
 * in the body matches something the workspace uploaded. A body supplies a *name*, never a
 * URL, so no message can point an image tag somewhere of its own choosing. The test for
 * an unknown name is that property stated from the other side.
 *
 * The rest guard the inline parser's "earliest match wins" rule, which is what keeps a
 * colon inside a URL from being read as the start of a shortcode.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { CustomEmoji } from "@blob/shared";
import { renderMarkdown, type RenderOptions } from "./markdown.tsx";
import type { MentionTarget } from "../features/messages/mentionIndex.ts";

afterEach(cleanup);

const shipit: CustomEmoji = {
  name: "shipit",
  url: "https://files.test/shipit.png",
};

function options(customEmoji: CustomEmoji[] = []): RenderOptions {
  return { knownNames: new Map(), currentUserId: null, customEmoji };
}

function draw(body: string, customEmoji: CustomEmoji[] = []) {
  return render(<div>{renderMarkdown(body, options(customEmoji))}</div>)
    .container;
}

/** People and groups in one map, the way `workspace_handles` holds them server-side. */
const KNOWN = new Map<string, MentionTarget>([
  ["ana", { kind: "user", id: "u-ana", isMe: false }],
  ["you", { kind: "user", id: "u-me", isMe: true }],
  ["platform-team", { kind: "group", id: "g-platform", isMe: false }],
  ["designers", { kind: "group", id: "g-design", isMe: true }],
]);

function drawMention(body: string) {
  return render(
    <div>
      {renderMarkdown(body, {
        knownNames: KNOWN,
        currentUserId: "u-me",
        customEmoji: [],
      })}
    </div>,
  ).container;
}

describe("custom emoji in a message body", () => {
  it("turns a built-in shortcode into its character", () => {
    const el = draw("ship it :tada:");
    expect(el.textContent).toContain("🎉");
    expect(el.querySelector("img")).toBeNull();
  });

  it("renders a workspace's own emoji as an image", () => {
    const img = draw("ship it :shipit:", [shipit]).querySelector("img");
    expect(img?.getAttribute("src")).toBe(shipit.url);
    expect(img?.getAttribute("alt")).toBe(":shipit:");
  });

  it("leaves an unknown name as the text that was typed", () => {
    const el = draw("this is :not_an_emoji: really", [shipit]);
    expect(el.textContent).toContain(":not_an_emoji:");
    expect(el.querySelector("img")).toBeNull();
  });

  it("renders nothing as an image once the emoji is deleted", () => {
    // Same body as the passing case above, with an empty workspace list.
    const el = draw("ship it :shipit:", []);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain(":shipit:");
  });

  it("does not convert a shortcode inside code", () => {
    const el = draw("use `:tada:` to celebrate");
    expect(el.querySelector("code")?.textContent).toBe(":tada:");
    expect(el.textContent).not.toContain("🎉");
  });

  it("leaves a colon inside a URL alone", () => {
    const el = draw("see http://example.com/a:b: now");
    expect(el.querySelector("a")?.getAttribute("href")).toContain(
      "example.com/a:b",
    );
    expect(el.querySelector("img")).toBeNull();
  });

  it("still renders a shortcode that follows a link", () => {
    const el = draw("http://example.com :tada:");
    expect(el.querySelector("a")).not.toBeNull();
    expect(el.textContent).toContain("🎉");
  });
});

describe("mentions", () => {
  it("marks a person it knows", () => {
    const mention = drawMention("hey @ana").querySelector(".mention");
    expect(mention?.textContent).toBe("@ana");
    expect(mention?.getAttribute("data-kind")).toBe("user");
  });

  it("marks a group as a group", () => {
    // The distinction the whole storage decision preserves, arriving on screen: a group
    // is not a person and does not have to pretend to be one.
    const mention = drawMention("@platform-team standup").querySelector(
      ".mention",
    );
    expect(mention?.textContent).toBe("@platform-team");
    expect(mention?.getAttribute("data-kind")).toBe("group");
  });

  it("leaves a name it does not know as plain text", () => {
    // The silent-ignore path, asserted so it reads as intentional. Highlighting an
    // unknown name would promise a notification that the server never sends.
    const container = drawMention("@nobody hello");
    expect(container.querySelector(".mention")).toBeNull();
    expect(container.textContent).toContain("@nobody");
  });

  it("knows when a mention is about you", () => {
    expect(
      drawMention("@you there?")
        .querySelector(".mention")
        ?.getAttribute("data-me"),
    ).toBe("true");
    expect(
      drawMention("@ana there?")
        .querySelector(".mention")
        ?.getAttribute("data-me"),
    ).toBe("false");
  });

  it("treats a group you are in as being about you", () => {
    // Being named as part of a team you are on is being named. `isMe` carries that,
    // rather than the renderer comparing ids it would have to be given separately.
    expect(
      drawMention("@designers ship it")
        .querySelector(".mention")
        ?.getAttribute("data-me"),
    ).toBe("true");
    expect(
      drawMention("@platform-team ship it")
        .querySelector(".mention")
        ?.getAttribute("data-me"),
    ).toBe("false");
  });

  it("never mentions anyone from inside code", () => {
    expect(
      drawMention("use `@ana` as the flag").querySelector(".mention"),
    ).toBeNull();
  });

  it("keeps trailing punctuation outside the chip", () => {
    const container = drawMention("thanks @ana!");
    expect(container.querySelector(".mention")?.textContent).toBe("@ana");
    expect(container.textContent).toContain("!");
  });
});

describe("parentheses in a link", () => {
  /** The href of the only link drawn, or null. */
  const hrefIn = (body: string) =>
    draw(body).querySelector("a")?.getAttribute("href") ?? null;

  it("keeps a balanced pair inside an explicit destination", () => {
    // `[^\s)]+` stopped at the first `)`, so this linked to `…/Mercury_(planet` and left
    // a stray bracket behind — a broken link that still looks like a link.
    expect(
      hrefIn("[planet](https://en.wikipedia.org/wiki/Mercury_(planet))"),
    ).toBe("https://en.wikipedia.org/wiki/Mercury_(planet)");
  });

  it("keeps a balanced pair in a bare URL", () => {
    expect(
      hrefIn("see https://en.wikipedia.org/wiki/Mercury_(planet) for more"),
    ).toBe("https://en.wikipedia.org/wiki/Mercury_(planet)");
  });

  it("still refuses the bracket that closes prose around it", () => {
    // The guard that has to survive the change: the URL ends at the domain, and the
    // bracket belongs to the sentence.
    expect(hrefIn("(details at https://example.com/x)")).toBe(
      "https://example.com/x",
    );
  });

  it("still refuses a full stop at the end of a sentence", () => {
    expect(hrefIn("read https://example.com/page.")).toBe(
      "https://example.com/page",
    );
  });

  it("leaves an ordinary link exactly as it was", () => {
    expect(hrefIn("[a](https://example.com/plain)")).toBe(
      "https://example.com/plain",
    );
    expect(hrefIn("https://example.com/plain")).toBe(
      "https://example.com/plain",
    );
  });
});
