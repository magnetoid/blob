/** The guide's data, held to what the app actually has.
 *
 * A help page is the one screen that can be wrong without anything failing: nothing
 * crashes when it names a shortcut nobody implemented or a command the server does not
 * answer — it just teaches people something untrue, indefinitely. These are the checks
 * that turn that into a red test.
 */

import { describe, expect, it } from 'vitest';
import { SECTIONS, allTopics, topicMatches, type Topic } from './help.ts';
import { SHORTCUTS } from './shortcuts.ts';
import { parseRoute } from './router.ts';

const topic = (over: Partial<Topic> = {}): Topic => ({
  id: 't',
  title: 'A topic',
  blurb: 'What it does',
  ...over,
});

describe('the guide', () => {
  it('has sections, each with something in it', () => {
    expect(SECTIONS.length).toBeGreaterThan(0);
    for (const section of SECTIONS) {
      // A generated section is allowed to be empty of prose — its rows come from
      // SHORTCUTS or from the server.
      if (!section.generated) expect(section.topics.length).toBeGreaterThan(0);
    }
  });

  it('gives every section and every topic an id nothing else uses', () => {
    // The ids are anchors: /help#threads has to keep meaning one place once somebody
    // has pasted it into a message.
    const ids = [...SECTIONS.map((s) => s.id), ...allTopics().map((t) => t.id)];
    expect([...new Set(ids)]).toHaveLength(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('only cites shortcuts that exist', () => {
    // The failure this prevents: renaming a binding's id leaves the page silently
    // rendering nothing where the keys were, and the topic reads as if it forgot.
    const known = new Set(SHORTCUTS.map((s) => s.id));
    const cited = allTopics().flatMap((t) => t.shortcuts ?? []);
    expect(cited.filter((id) => !known.has(id))).toEqual([]);
  });

  it('only points at routes that resolve', () => {
    const dead = allTopics()
      .map((t) => t.path)
      .filter((path): path is string => Boolean(path))
      .filter((path) => path !== '/' && parseRoute(path).view === 'messages');
    expect(dead).toEqual([]);
  });

  it('says something before it explains anything', () => {
    // The blurb is what somebody who reads one line gets. A topic without one is a
    // topic that answers nothing until you read three paragraphs.
    for (const t of allTopics()) {
      expect(t.blurb.length).toBeGreaterThan(10);
    }
  });
});

describe('the filter', () => {
  it('matches every word, in any order', () => {
    const t = topic({ title: 'Marking a conversation unread' });

    expect(topicMatches(t, 'unread mark')).toBe(true);
    expect(topicMatches(t, 'unread archive')).toBe(false);
  });

  it('looks in the body, the steps and the keywords', () => {
    expect(topicMatches(topic({ body: ['keyset pagination'] }), 'keyset')).toBe(true);
    expect(topicMatches(topic({ steps: ['Press the button'] }), 'press')).toBe(true);
    // Keywords are for the words somebody types that the prose happens not to contain:
    // "notification" when the page says "notify".
    expect(topicMatches(topic({ keywords: ['notification'] }), 'notification')).toBe(true);
  });

  it('finds a command by the slash somebody typed', () => {
    expect(topicMatches(topic({ commands: ['remind'] }), '/remind')).toBe(true);
  });

  it('keeps everything when nothing is typed', () => {
    expect(topicMatches(topic(), '   ')).toBe(true);
  });
});
