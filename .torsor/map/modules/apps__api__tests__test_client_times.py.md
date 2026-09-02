---
type: map
status: derived
tags:
- map
links: []
created: '2026-09-02T06:12:04'
updated: '2026-09-02T06:12:04'
---

# apps/api/tests/test_client_times.py

Symbols in `apps/api/tests/test_client_times.py`.

- L31 `setup(client: Client)` (function)
- L38 `_send(setup: dict, which: str, value: str)` (function)
- L55 `TestATimeWithNoZone` (class)
- L57 `test_is_refused_rather_than_guessed_at(self, setup: dict, which: str)` (method)
- L64 `TestATimeThatIsNotOne` (class)
- L66 `test_is_refused_the_same_way_everywhere(self, setup: dict, which: str)` (method)
- L73 `TestAProperTime` (class)
- L75 `test_is_accepted(self, setup: dict, which: str)` (method)
- L83 `TestAMomentThatHasPassed` (class)
- L84 `test_is_refused_where_only_the_future_makes_sense(self, setup: dict)` (method)
- L90 `test_but_allowed_where_it_is_meaningful(self, setup: dict)` (method)
