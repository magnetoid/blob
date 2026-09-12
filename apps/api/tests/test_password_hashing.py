"""The hasher the server signs people up with.

Argon2's defaults are the point in production and a tax in the suite: every fixture that
signs somebody up paid ~75 ms per hash and again per login, thousands of times a run. A
profile lets the suite ask for a cheap hasher — and only the suite, because a stored
hash carries its own parameters, so a cheap one minted anywhere else would verify in
production for as long as that account existed.
"""

from __future__ import annotations

from argon2 import PasswordHasher

from blob_api.lib.auth import build_hasher

ARGON2_DEFAULT = PasswordHasher()


def _params(hasher: PasswordHasher) -> tuple[int, int, int]:
    return hasher.time_cost, hasher.memory_cost, hasher.parallelism


def test_the_default_profile_is_argon2s_own() -> None:
    assert _params(build_hasher("default", testing=False)) == _params(ARGON2_DEFAULT)


def test_the_fast_profile_is_cheap_under_test() -> None:
    hasher = build_hasher("fast", testing=True)
    assert _params(hasher) == (1, 8 * 1024, 1)
    # A real hasher still reads what the cheap one wrote: the parameters travel in the
    # PHC string, which is why mixing the two is safe in either direction.
    digest = hasher.hash("correct-horse-battery")
    assert ARGON2_DEFAULT.verify(digest, "correct-horse-battery")


def test_the_fast_profile_is_refused_outside_test() -> None:
    # The setting alone is not enough. A production box with a copied .env must never
    # end up minting cheap hashes because somebody left the test value in it.
    assert _params(build_hasher("fast", testing=False)) == _params(ARGON2_DEFAULT)
