"""The words in a voice message (M3 · B2).

A recording arrives with no words; this job asks the speech service for them, writes them
as the message's body — so search finds it, a notification can say it, and an agent can
read it — and then starts the agent run the message would have started had it been typed,
which `messages.announce` held back for exactly this. A failure is a status on the
attachment the client shows ("no transcript"), never an error anybody has to deal with:
the recording still plays, and the agent whose DM it is hears that it could not be read.
"""

from __future__ import annotations

import logging
from typing import Any

from ..db.engine import session_scope, transaction
from ..lib import queue as queue_lib
from ..lib import storage, stt
from ..realtime import hub
from ..services import messages as message_service
from ..services.agent_follows import is_followed
from ..services.serialize import message_event

log = logging.getLogger("blob.jobs.transcribe")

#: What a speech service is asked to take in one request — OpenAI's own ceiling. A voice
#: message is at most five minutes, which at any codec a browser records is far under it.
MAX_AUDIO_BYTES = 25 * 1024 * 1024


async def handle_transcribe(message_id: str) -> None:
    async with session_scope() as session:
        voice = await message_service.voice_to_transcribe(session, message_id)
    if voice is None:
        return  # deleted, already transcribed, or never waiting

    try:
        audio = await storage.get_object(voice.object_key, max_bytes=MAX_AUDIO_BYTES)
        words = await stt.transcribe(audio, filename=voice.filename, content_type=voice.mime)
    except Exception as error:  # the speech service, the store, or the size: all the same here
        log.warning("could not transcribe %s: %s", message_id, error)
        await _settle(message_id, failed=True)
        return

    await _settle(message_id, failed=False, words=words)


async def _settle(message_id: str, *, failed: bool, words: str = "") -> None:
    async with transaction() as (session, after):
        if failed or not words:
            # Silence, or nothing usable: say so rather than leave it "transcribing".
            await message_service.mark_transcript(session, message_id, "failed")
            message = await message_service.by_id(session, message_id)
            starts_runs = message is not None and await _starts_runs(
                session, message, with_words=False
            )
        else:
            message = await message_service.set_transcript(
                session, message_id, transcript=words, provider=stt.provider_label()
            )
            starts_runs = message is not None and await _starts_runs(
                session, message, with_words=True
            )
        if message is None:
            return

        def broadcast() -> None:
            hub.to_channel(message.channel_id, message_event("message.updated", message))
            if starts_runs:
                queue_lib.fire_and_forget(queue_lib.enqueue("agui_run", message.id))

        after.add(broadcast)


async def _starts_runs(session: Any, message: Any, *, with_words: bool) -> bool:
    """What `announce` would have asked of a typed message: a person's, not a guest's, in
    a DM with an agent — or, when there are words to hear, a channel an agent follows,
    since a follower nobody addressed is not woken for a recording it cannot read. A
    spoken @name is not a mention — nobody picked it from a list — so mentions do not
    count here."""
    if message.kind != "user" or await message_service.is_guest(session, message.author_id):
        return False
    if await message_service.addressed_by_the_room(session, channel_id=message.channel_id):
        return True
    return with_words and await is_followed(session, channel_id=message.channel_id)
