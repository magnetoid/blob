/**
 * The hand-written client types, checked against the server's own OpenAPI.
 *
 * `packages/shared/src/types.ts` is what every screen is written against, and it is
 * written by hand. The server describes the same shapes in `openapi.json`, which is
 * generated from the Pydantic models — so the two can drift, silently, in the one
 * direction nobody notices: the server adds a field, or widens one to null, and the
 * client keeps compiling against the shape it remembers.
 *
 * This asserts assignability in both directions, so a field either side adds, drops or
 * re-types is a red typecheck rather than a runtime surprise. Optionality is normalised
 * away first: FastAPI marks a field with a default as not *required* in the schema
 * while always serialising it, so `Norm` compares what is actually on the wire.
 *
 * Run by `vitest --typecheck`; nothing here executes.
 */

import { describe, expectTypeOf, it } from 'vitest';
import type * as Hand from './types.ts';
import type * as Gen from './generated/api.d.ts';

/**
 * Every property present, all the way down.
 *
 * FastAPI marks a field with a default as not *required* in the schema while always
 * serialising it, so the generated type says `field?: T` where the wire says `field: T`.
 * Optionality is therefore normalised away — recursively, because the same artifact
 * appears again inside arrays of objects — and what is left to compare is the part that
 * can actually drift: the names and the types.
 */
type Norm<T> = T extends (infer E)[]
  ? Norm<E>[]
  : T extends object
    ? { [K in keyof T]-?: Norm<T[K]> }
    : T;

describe('the types the client is written against are the ones the server describes', () => {
  it('agrees about people', () => {
    expectTypeOf<Norm<Gen.User>>().toMatchTypeOf<Norm<Hand.User>>();
    expectTypeOf<Norm<Hand.User>>().toMatchTypeOf<Norm<Gen.User>>();
    expectTypeOf<Norm<Gen.UserGroup>>().toMatchTypeOf<Norm<Hand.UserGroup>>();
    expectTypeOf<Norm<Hand.UserGroup>>().toMatchTypeOf<Norm<Gen.UserGroup>>();
    expectTypeOf<Norm<Gen.Workspace>>().toMatchTypeOf<Norm<Hand.Workspace>>();
    expectTypeOf<Norm<Hand.Workspace>>().toMatchTypeOf<Norm<Gen.Workspace>>();
  });

  it('agrees about messages and their parts', () => {
    expectTypeOf<Norm<Gen.Reaction>>().toMatchTypeOf<Norm<Hand.Reaction>>();
    expectTypeOf<Norm<Hand.Reaction>>().toMatchTypeOf<Norm<Gen.Reaction>>();
    expectTypeOf<Norm<Gen.Attachment>>().toMatchTypeOf<Norm<Hand.Attachment>>();
    expectTypeOf<Norm<Hand.Attachment>>().toMatchTypeOf<Norm<Gen.Attachment>>();
    expectTypeOf<Norm<Gen.LinkPreview>>().toMatchTypeOf<Norm<Hand.LinkPreview>>();
    expectTypeOf<Norm<Hand.LinkPreview>>().toMatchTypeOf<Norm<Gen.LinkPreview>>();
    expectTypeOf<Norm<Gen.MessageTranslation>>().toMatchTypeOf<Norm<Hand.MessageTranslation>>();
    expectTypeOf<Norm<Hand.MessageTranslation>>().toMatchTypeOf<Norm<Gen.MessageTranslation>>();
  });

  it('agrees about channels', () => {
    expectTypeOf<Norm<Gen.BrowsableChannel>>().toMatchTypeOf<Norm<Hand.BrowsableChannel>>();
    expectTypeOf<Norm<Hand.BrowsableChannel>>().toMatchTypeOf<Norm<Gen.BrowsableChannel>>();
  });

  it('agrees about the agentic surface', () => {
    expectTypeOf<Norm<Gen.AgentTask>>().toMatchTypeOf<Norm<Hand.AgentTask>>();
    expectTypeOf<Norm<Hand.AgentTask>>().toMatchTypeOf<Norm<Gen.AgentTask>>();
    expectTypeOf<Norm<Gen.ThreadSummaryDecision>>().toMatchTypeOf<Norm<Hand.ThreadSummaryDecision>>();
    expectTypeOf<Norm<Hand.ThreadSummaryDecision>>().toMatchTypeOf<Norm<Gen.ThreadSummaryDecision>>();
    expectTypeOf<Norm<Gen.ThreadSummaryOpenQuestion>>().toMatchTypeOf<Norm<Hand.ThreadSummaryOpenQuestion>>();
    expectTypeOf<Norm<Hand.ThreadSummaryOpenQuestion>>().toMatchTypeOf<Norm<Gen.ThreadSummaryOpenQuestion>>();
    expectTypeOf<Norm<Gen.ThreadSummaryActionItem>>().toMatchTypeOf<Norm<Hand.ThreadSummaryActionItem>>();
    expectTypeOf<Norm<Hand.ThreadSummaryActionItem>>().toMatchTypeOf<Norm<Gen.ThreadSummaryActionItem>>();
  });

  it('agrees about the rest of the workspace', () => {
    expectTypeOf<Norm<Gen.CommandSpec>>().toMatchTypeOf<Norm<Hand.CommandSpec>>();
    expectTypeOf<Norm<Hand.CommandSpec>>().toMatchTypeOf<Norm<Gen.CommandSpec>>();
    expectTypeOf<Norm<Gen.CustomEmoji>>().toMatchTypeOf<Norm<Hand.CustomEmoji>>();
    expectTypeOf<Norm<Hand.CustomEmoji>>().toMatchTypeOf<Norm<Gen.CustomEmoji>>();
    expectTypeOf<Norm<Gen.FeedbackTicket>>().toMatchTypeOf<Norm<Hand.FeedbackTicket>>();
    expectTypeOf<Norm<Hand.FeedbackTicket>>().toMatchTypeOf<Norm<Gen.FeedbackTicket>>();
    expectTypeOf<Norm<Gen.FileEntry>>().toMatchTypeOf<Norm<Hand.FileEntry>>();
    expectTypeOf<Norm<Hand.FileEntry>>().toMatchTypeOf<Norm<Gen.FileEntry>>();
  });

  it('agrees about the boot payload and what fills it', () => {
    expectTypeOf<Norm<Gen.Bootstrap>>().toMatchTypeOf<Norm<Hand.Bootstrap>>();
    expectTypeOf<Norm<Hand.Bootstrap>>().toMatchTypeOf<Norm<Gen.Bootstrap>>();
    expectTypeOf<Norm<Gen.CurrentUser>>().toMatchTypeOf<Norm<Hand.CurrentUser>>();
    expectTypeOf<Norm<Hand.CurrentUser>>().toMatchTypeOf<Norm<Gen.CurrentUser>>();
    expectTypeOf<Norm<Gen.UserPrefs>>().toMatchTypeOf<Norm<Hand.UserPrefs>>();
    expectTypeOf<Norm<Hand.UserPrefs>>().toMatchTypeOf<Norm<Gen.UserPrefs>>();
    expectTypeOf<Norm<Gen.Channel>>().toMatchTypeOf<Norm<Hand.Channel>>();
    expectTypeOf<Norm<Hand.Channel>>().toMatchTypeOf<Norm<Gen.Channel>>();
    expectTypeOf<Norm<Gen.ChannelWithState>>().toMatchTypeOf<Norm<Hand.ChannelWithState>>();
    expectTypeOf<Norm<Hand.ChannelWithState>>().toMatchTypeOf<Norm<Gen.ChannelWithState>>();
    expectTypeOf<Norm<Gen.ThemeSummary>>().toMatchTypeOf<Norm<Hand.Theme>>();
    expectTypeOf<Norm<Hand.Theme>>().toMatchTypeOf<Norm<Gen.ThemeSummary>>();
  });

  it('agrees about what a schedule and a piece of work are', () => {
    expectTypeOf<Norm<Gen.ScheduledMessage>>().toMatchTypeOf<Norm<Hand.ScheduledMessage>>();
    expectTypeOf<Norm<Hand.ScheduledMessage>>().toMatchTypeOf<Norm<Gen.ScheduledMessage>>();
    expectTypeOf<Norm<Gen.Work>>().toMatchTypeOf<Norm<Hand.Work>>();
    expectTypeOf<Norm<Hand.Work>>().toMatchTypeOf<Norm<Gen.Work>>();
    expectTypeOf<Norm<Gen.ThreadSummary>>().toMatchTypeOf<Norm<Hand.ThreadSummary>>();
    expectTypeOf<Norm<Hand.ThreadSummary>>().toMatchTypeOf<Norm<Gen.ThreadSummary>>();
  });

  /**
   * `Message` is the deliberate exception, and only in its `blocks`. The server stores
   * whatever an app published as JSON and describes it as such; the client types the
   * seven block shapes it knows how to draw, and renders nothing for anything else.
   * Narrowing on the reading side is the point, so the two are compared without it.
   */
  it('agrees about a message, apart from the blocks the client narrows', () => {
    type ServerMessage = Omit<Norm<Gen.Message>, 'blocks'>;
    type ClientMessage = Omit<Norm<Hand.Message>, 'blocks'>;
    expectTypeOf<ServerMessage>().toMatchTypeOf<ClientMessage>();
    expectTypeOf<ClientMessage>().toMatchTypeOf<ServerMessage>();
  });
});
