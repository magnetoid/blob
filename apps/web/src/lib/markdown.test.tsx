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

describe("XSS goldens", () => {
  /**
   * Nothing in this file becomes raw HTML. These pin the schemes and tags that would
   * become a problem the moment a renderer started trusting the body as markup.
   */
  const hrefIn = (body: string) =>
    draw(body).querySelector("a")?.getAttribute("href") ?? null;

  it("does not turn a javascript: markdown link into an href", () => {
    const el = draw("[x](javascript:alert(1))");
    expect(hrefIn("[x](javascript:alert(1))")).toBeNull();
    expect(el.querySelector("a")).toBeNull();
    expect(el.textContent).toContain("javascript:alert(1)");
  });

  it("does not turn a data: markdown link into an href", () => {
    expect(hrefIn("[x](data:text/html,<script>alert(1)</script>)")).toBeNull();
  });

  it("does not turn a vbscript: markdown link into an href", () => {
    expect(hrefIn("[x](vbscript:msgbox(1))")).toBeNull();
  });

  it("leaves HTML tags as text, never as elements", () => {
    const el = draw('<img src=x onerror=alert(1)><script>alert(1)</script>');
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toContain("<script>alert(1)</script>");
  });

  it("does not honour an unknown-scheme bare URL", () => {
    expect(hrefIn("javascript:alert(1)")).toBeNull();
    expect(hrefIn("data:text/html,hi")).toBeNull();
  });
});

describe("search hit highlighting", () => {
  function drawHit(body: string, highlight: string) {
    return render(
      <div>
        {renderMarkdown(body, { ...options(), highlight })}
      </div>,
    ).container;
  }

  it("wraps the matching words in a mark", () => {
    const el = drawHit("please deploy now", "deploy");
    expect(el.querySelector("mark.search-hit")?.textContent).toBe("deploy");
    expect(el.textContent).toBe("please deploy now");
  });

  it("is case-insensitive and keeps the author's casing", () => {
    const el = drawHit("Please Deploy Now", "deploy");
    expect(el.querySelector("mark.search-hit")?.textContent).toBe("Deploy");
  });

  it("does not highlight inside a code span", () => {
    const el = drawHit("run `deploy` please", "deploy");
    expect(el.querySelector("code")?.textContent).toBe("deploy");
    expect(el.querySelector("code mark")).toBeNull();
  });
});

describe("headings, for documents only", () => {
  function drawDocument(body: string) {
    return render(
      <div>{renderMarkdown(body, { ...options(), headings: true })}</div>,
    ).container;
  }

  it("a message has none — a leading # is just a character", () => {
    const container = draw("# general is where standup happens");
    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).toContain("# general is where standup happens");
  });

  it("a document gets them, one to six levels, as elements", () => {
    const container = drawDocument("# Plan\n\n## Friday\nShip **it**.\n###### Small");
    expect(container.querySelector("h1")?.textContent).toBe("Plan");
    expect(container.querySelector("h2")?.textContent).toBe("Friday");
    expect(container.querySelector("h6")?.textContent).toBe("Small");
    expect(container.querySelector("p strong")?.textContent).toBe("it");
  });

  it("a heading's text is rendered inline like any other, never as markup", () => {
    const container = drawDocument("# <img src=x onerror=alert(1)> *bold*");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toContain("<img src=x");
  });

  it("needs the space after the hashes, as CommonMark does", () => {
    const container = drawDocument("#hashtag");
    expect(container.querySelector("h1")).toBeNull();
  });
});

/** The `<li>` children of one list, not of the lists nested in it. */
const itemsOf = (list: Element | null | undefined) =>
  [...(list?.children ?? [])].filter((child) => child.tagName === "LI");

describe("lists, for everybody", () => {
  /**
   * Not an agent feature: anybody who numbers a list with room to breathe, or indents a
   * sub-point, writes it this way. Both used to come apart — every item after a blank line
   * opened a new list that counted from 1 again, and an indented line broke the list and
   * showed its dash.
   */
  it("keeps numbered items a blank line apart in one list", () => {
    const container = draw("1. First\n\n2. Second\n\n3. Third");
    const lists = container.querySelectorAll("ol");
    expect(lists).toHaveLength(1);
    expect(itemsOf(lists[0]).map((item) => item.textContent)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(lists[0]?.hasAttribute("start")).toBe(false);
    // Written apart, drawn apart: the gap the separate lists used to make between them.
    expect(lists[0]?.getAttribute("data-loose")).toBe("true");
  });

  it("leaves a list written without gaps tight, and unmarked", () => {
    const list = draw("1. First\n2. Second").querySelector("ol");
    expect(itemsOf(list)).toHaveLength(2);
    expect(list?.hasAttribute("data-loose")).toBe(false);
  });

  it("does the same for bullets", () => {
    const container = draw("- one\n\n- two");
    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(itemsOf(container.querySelector("ul"))).toHaveLength(2);
  });

  it("counts on from where a list resumed after a paragraph left off", () => {
    const lists = draw(
      "1. One\n2. Two\n\nA word about the first two.\n\n3. Three\n4. Four",
    ).querySelectorAll("ol");
    expect(lists).toHaveLength(2);
    expect(lists[0]?.hasAttribute("start")).toBe(false);
    expect(lists[1]?.getAttribute("start")).toBe("3");
  });

  it("starts at the number that was written", () => {
    expect(draw("7. Seven\n8. Eight").querySelector("ol")?.getAttribute("start")).toBe(
      "7",
    );
  });

  it("nests an indented bullet under its item", () => {
    const container = draw("- Parent\n  - child a\n  - child b\n- Sibling");
    const top = container.querySelector("ul");
    const items = itemsOf(top);
    expect(items).toHaveLength(2);
    const nested = items[0]?.querySelector(":scope > ul");
    expect(itemsOf(nested).map((item) => item.textContent)).toEqual([
      "child a",
      "child b",
    ]);
    expect(items[1]?.textContent).toBe("Sibling");
    // No stray dashes: the sub-points are list items, not text.
    expect(container.textContent).not.toContain("-");
  });

  it("nests numbered under numbered, and goes two levels down", () => {
    const container = draw(
      "1. Step\n   1. first part\n   2. second part\n      - a detail\n2. Next step",
    );
    const top = container.querySelector("ol");
    const steps = itemsOf(top);
    expect(steps).toHaveLength(2);
    const parts = itemsOf(steps[0]?.querySelector(":scope > ol"));
    expect(parts).toHaveLength(2);
    expect(parts[1]?.querySelector(":scope > ul > li")?.textContent).toBe("a detail");
    expect(steps[1]?.textContent).toBe("Next step");
  });

  it("takes a tab as indentation", () => {
    const nested = draw("- a\n\t- b\n\t\t- c").querySelector("ul > li > ul > li > ul > li");
    expect(nested?.textContent).toBe("c");
  });

  it("joins an indented line to the item above it", () => {
    const container = draw("- **Speed**: the new engine is\n  much faster.\n- Done");
    const items = itemsOf(container.querySelector("ul"));
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe("Speed: the new engine is\nmuch faster.");
    expect(items[0]?.querySelector("strong")?.textContent).toBe("Speed");
    expect(container.querySelector("p")).toBeNull();
  });

  it("keeps a paragraph indented under an item, after a blank line, in that item", () => {
    const container = draw("1. Title\n\n   More about it.\n\n2. Next");
    const items = itemsOf(container.querySelector("ol"));
    expect(items).toHaveLength(2);
    expect([...(items[0]?.querySelectorAll("p") ?? [])].map((p) => p.textContent)).toEqual([
      "Title",
      "More about it.",
    ]);
  });

  it("keeps a fenced block under an item inside it", () => {
    const container = draw("1. Install:\n   ```bash\n   pnpm install\n   ```\n2. Run it");
    const items = itemsOf(container.querySelector("ol"));
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector("pre code")?.textContent).toBe("pnpm install");
    expect(container.querySelectorAll("ol")).toHaveLength(1);
  });

  it("still ends at a line that is not indented under it", () => {
    const container = draw("- a\nnot part of it");
    expect(itemsOf(container.querySelector("ul"))).toHaveLength(1);
    expect(container.querySelector("p")?.textContent).toBe("not part of it");
  });

  it("starts a new list where the kind of marker changes", () => {
    const container = draw("1. numbered\n- bulleted");
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    expect(container.querySelectorAll("ul")).toHaveLength(1);
  });

  it("reads a CRLF body the way it reads LF", () => {
    const list = draw("1. one\r\n2. two").querySelector("ol");
    expect(itemsOf(list).map((item) => item.textContent)).toEqual(["one", "two"]);
  });
});

describe("an agent's reply", () => {
  function drawAgent(body: string, extra: Partial<RenderOptions> = {}) {
    return render(
      <div>
        {renderMarkdown(body, {
          knownNames: KNOWN,
          currentUserId: "u-me",
          customEmoji: [],
          agent: true,
          ...extra,
        })}
      </div>,
    ).container;
  }

  describe("headings become section labels", () => {
    it("draws a # line as a bold label at body size, never as a heading element", () => {
      const container = drawAgent("## Summary\nThe dip was isolated.");
      const label = container.querySelector("p.md-section");
      expect(label?.querySelector("strong")?.textContent).toBe("Summary");
      expect(container.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
      expect(container.querySelectorAll("p")[1]?.textContent).toBe("The dip was isolated.");
    });

    it("draws every level, one to six, the same way", () => {
      const container = drawAgent("# One\n### Three\n###### Six");
      expect(
        [...container.querySelectorAll("p.md-section")].map((p) => p.textContent),
      ).toEqual(["One", "Three", "Six"]);
    });

    it("renders a label's text inline, never as markup", () => {
      const container = drawAgent("## <img src=x onerror=alert(1)> `code`");
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".md-section code")?.textContent).toBe("code");
    });

    it("leaves a document's real headings to a document", () => {
      const container = drawAgent("## Friday", { headings: true });
      expect(container.querySelector("h2")?.textContent).toBe("Friday");
      expect(container.querySelector(".md-section")).toBeNull();
    });
  });

  describe("pipe tables", () => {
    const TABLE = [
      "| Metric | Before | After |",
      "|:-------|:------:|------:|",
      "| p95 | 120 ms | 80 ms |",
      "| errors | 3 | 0 |",
    ].join("\n");

    it("draws a real table, with a header row and a body", () => {
      const container = drawAgent(TABLE);
      const table = container.querySelector(".md-table-wrap > table.md-table");
      expect(table).not.toBeNull();
      expect(
        [...(table?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent),
      ).toEqual(["Metric", "Before", "After"]);
      expect(table?.querySelectorAll('thead th[scope="col"]')).toHaveLength(3);
      const rows = table?.querySelectorAll("tbody tr") ?? [];
      expect(rows).toHaveLength(2);
      expect([...(rows[0]?.querySelectorAll("td") ?? [])].map((td) => td.textContent)).toEqual([
        "p95",
        "120 ms",
        "80 ms",
      ]);
      expect(container.textContent).not.toContain("|");
    });

    it("aligns columns the way the delimiter row says", () => {
      const container = drawAgent(
        "| a | b | c | d |\n|:--|:-:|--:|---|\n| 1 | 2 | 3 | 4 |",
      );
      const align = (selector: string) =>
        [...container.querySelectorAll(selector)].map((cell) => cell.getAttribute("data-align"));
      expect(align("th")).toEqual(["left", "center", "right", null]);
      expect(align("td")).toEqual(["left", "center", "right", null]);
    });

    it("renders a cell's text inline: bold, code, links and mentions", () => {
      const container = drawAgent(
        "| Who | What |\n|---|---|\n| @ana | **shipped** `v2` — [notes](https://example.com/notes) |",
      );
      const cells = container.querySelectorAll("td");
      expect(cells[0]?.querySelector(".mention")?.textContent).toBe("@ana");
      expect(cells[1]?.querySelector("strong")?.textContent).toBe("shipped");
      expect(cells[1]?.querySelector("code")?.textContent).toBe("v2");
      expect(cells[1]?.querySelector("a")?.getAttribute("href")).toBe(
        "https://example.com/notes",
      );
    });

    it("keeps an escaped pipe inside its cell", () => {
      const cells = drawAgent("| Flag | Meaning |\n|---|---|\n| `a \\| b` | either |").querySelectorAll(
        "td",
      );
      expect(cells).toHaveLength(2);
      expect(cells[0]?.textContent).toBe("a | b");
    });

    it("evens out ragged rows as GitHub does", () => {
      const rows = drawAgent(
        "| a | b | c |\n|---|---|---|\n| short |\n| 1 | 2 | 3 | extra |",
      ).querySelectorAll("tbody tr");
      // A short row gets empty cells…
      expect([...(rows[0]?.querySelectorAll("td") ?? [])].map((td) => td.textContent)).toEqual([
        "short",
        "",
        "",
      ]);
      // …and what a long one has past the header is not drawn.
      expect([...(rows[1]?.querySelectorAll("td") ?? [])].map((td) => td.textContent)).toEqual([
        "1",
        "2",
        "3",
      ]);
    });

    it("puts a table indented under a list item inside that item", () => {
      const container = drawAgent(
        "1. Compare the options:\n\n   | Option | Cost |\n   |---|--:|\n   | A | 3 |\n\n2. Pick one",
      );
      const items = itemsOf(container.querySelector("ol"));
      expect(items).toHaveLength(2);
      expect(items[0]?.querySelector(".md-table-wrap td[data-align='right']")?.textContent).toBe(
        "3",
      );
      expect(container.textContent).not.toContain("|");
    });

    it("draws a header with no body rows as a table too", () => {
      const container = drawAgent("| a | b |\n|---|---|");
      expect(container.querySelectorAll("th")).toHaveLength(2);
      expect(container.querySelector("tbody")).toBeNull();
    });

    it("is not a table when the delimiter row has a different number of columns", () => {
      const container = drawAgent("| a | b | c |\n|---|---|\n| 1 | 2 | 3 |");
      expect(container.querySelector("table")).toBeNull();
      expect(container.textContent).toContain("| a | b | c |");
    });

    it("ends at a line with no pipe, and starts after a paragraph line", () => {
      const container = drawAgent(
        "Here are the numbers:\n| a | b |\n|---|---|\n| 1 | 2 |\nThat is all.",
      );
      const paragraphs = [...container.querySelectorAll("p")].map((p) => p.textContent);
      expect(paragraphs).toEqual(["Here are the numbers:", "That is all."]);
      expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    });

    it("marks short cells to stay on one line, and leaves prose to wrap", () => {
      const container = drawAgent(
        "| Value | Note |\n|---|---|\n| 2,400 ms | the relay timed out and every retry queued behind it |",
      );
      const cells = container.querySelectorAll("td");
      expect(cells[0]?.getAttribute("data-short")).toBe("true");
      expect(cells[1]?.hasAttribute("data-short")).toBe(false);
    });

    it("links nothing but http(s) from inside a cell either", () => {
      const container = drawAgent(
        "| a |\n|---|\n| [x](javascript:alert(1)) <script>alert(1)</script> |",
      );
      expect(container.querySelector("a")).toBeNull();
      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("td")?.textContent).toContain("<script>");
    });
  });

  describe("dividers", () => {
    it("draws a line of three dashes, stars or underscores as a divider", () => {
      for (const rule of ["---", "***", "___", "- - -", "* * *", "-----"]) {
        const container = drawAgent(`Above\n\n${rule}\n\nBelow`);
        expect(container.querySelector("hr.md-divider"), rule).not.toBeNull();
        expect([...container.querySelectorAll("p")].map((p) => p.textContent), rule).toEqual([
          "Above",
          "Below",
        ]);
      }
    });

    it("ends a paragraph it follows directly", () => {
      const container = drawAgent("Above\n---\nBelow");
      expect(container.querySelector("hr")).not.toBeNull();
      expect(container.querySelectorAll("p")).toHaveLength(2);
    });

    it("needs three", () => {
      expect(drawAgent("--").querySelector("hr")).toBeNull();
    });
  });

  it("keeps the fixed lists, with every construct of its own around them", () => {
    const container = drawAgent(
      "## Plan\n\n1. Add a breaker\n   - in front of the relay\n\n2. Alert on depth\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |",
    );
    expect(container.querySelector(".md-section")?.textContent).toBe("Plan");
    expect(itemsOf(container.querySelector("ol"))).toHaveLength(2);
    expect(container.querySelector("ol > li > ul > li")?.textContent).toBe("in front of the relay");
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });
});

describe("a person's message keeps the chat dialect", () => {
  /**
   * The same body an agent's reply renders as a label, a table and a divider stays
   * exactly what was typed when a person sent it: `#` is a channel or a number in a chat
   * line far more often than a title, and nobody asked for a person's pipes to become
   * a table.
   */
  const BODY = [
    "## not a heading",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "",
    "---",
    "",
    "***",
  ].join("\n");

  it("draws no label, no table and no divider", () => {
    const container = draw(BODY);
    expect(container.querySelector(".md-section, h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(container.querySelector("table, .md-table-wrap")).toBeNull();
    expect(container.querySelector("hr")).toBeNull();
  });

  it("shows the characters that were typed", () => {
    const paragraphs = [...draw(BODY).querySelectorAll("p")].map((p) => p.textContent);
    expect(paragraphs).toEqual([
      "## not a heading",
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "---",
      "***",
    ]);
  });

  it("keeps a table indented under a list item as that item's text", () => {
    const item = draw("- options:\n  | a | b |\n  |---|---|").querySelector("li");
    expect(item?.querySelector("table")).toBeNull();
    expect(item?.textContent).toBe("options:\n| a | b |\n|---|---|");
  });

  it("is what the agent flag being absent and being false both mean", () => {
    const off = render(
      <div>
        {renderMarkdown(BODY, {
          knownNames: new Map(),
          currentUserId: null,
          customEmoji: [],
          agent: false,
        })}
      </div>,
    ).container.innerHTML;
    cleanup();
    expect(draw(BODY).innerHTML).toBe(off);
  });
});
