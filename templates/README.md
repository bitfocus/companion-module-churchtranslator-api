# Companion page templates

`translator-page.companionconfig` is a ready-made "Translator" page for
Bitfocus Companion (v4, config version 12), extracted from a working
church deck and sanitized. Import it via Companion's **Import / Export →
Import** and choose just the page and the ChurchTranslator connection —
then paste the church's own capture token into the connection (the
template ships with the token field empty on purpose).

What's on the page (a 2-row layout for a 5-column deck):

| Key             | Button             | Behavior                                                                                                                 |
| --------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| row 0, col 1    | Status + listeners | `STATUS` / `N LISTENING` via an uppercase expression; green while live, amber while paused; press = force status refresh |
| row 0, col 2    | START              | lights green while the service is live                                                                                   |
| row 0, col 3    | PAUSE / RESUME     | label flips with live state; amber while paused                                                                          |
| row 0, col 4    | STOP               | turns red while live                                                                                                     |
| row 1, cols 1–3 | Language keys      | Russian / English / Ukrainian; the active source language lights green                                                   |

The language keys are just examples — swap the `set_source_language`
option codes (and labels) for the languages the church actually uses, or
delete them and drag fresh ones from the module's presets, which are
generated from the church's own language list.

**Health read-out (module 1.2.0).** This file is now GENERATED, not
hand-edited: it is the server's per-church download
(`services/api/app/companion_config.py`) built with the health read-out on,
a blank token and the prod URL — RU/EN/UK keys whose second line is that
language's listener count (`$(ChurchTranslator:listeners_<code>)`), amber /
red `language_trouble` feedbacks after the green lamp, NO SOUND / NO FEED on
the status lamp, and an input-meter key at row 0, col 5. The added buttons
come from `services/api/app/data/companion_health_additions.json`, which was
exported from a real Companion 5.0.3 running this module's own presets
(`controls.importPreset`, then `/int/export/page`), so the layered-button
schema is exactly what Companion writes. Verified 2026-10-02: imported into
Companion 5.0.3 with module 1.2.0 against the dev API, live listeners and
audio — counts, meter, NO SOUND and its clearing all rendered.

The connection names module **`churchtranslator-api` with no pinned
version**. The original export named `churchtranslator-churchtranslator`
v1.0.0, which Companion could not resolve anywhere (legacyIds are not
consulted on import), so the imported connection was a dead "unknown
module".

Regenerating: rebuild it from `companion_config.build_config(...,
health=True)` with an empty token (see the commit that introduced the
generated form), or — for the base page itself — export a full config from
a configured Companion, then strip it down to one page + the
ChurchTranslator connection and blank `secrets.token`. **Verify the token is gone before committing** —
Companion full exports include connection secrets in cleartext.
