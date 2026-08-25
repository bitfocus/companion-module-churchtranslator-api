# Companion page templates

`translator-page.companionconfig` is a ready-made "Translator" page for
Bitfocus Companion (v4, config version 12), extracted from a working
church deck and sanitized. Import it via Companion's **Import / Export →
Import** and choose just the page and the ChurchTranslator connection —
then paste the church's own capture token into the connection (the
template ships with the token field empty on purpose).

What's on the page (a 2-row layout for a 5-column deck):

| Key | Button | Behavior |
| --- | --- | --- |
| row 0, col 1 | Status + listeners | `STATUS` / `N LISTENING` via an uppercase expression; green while live, amber while paused; press = force status refresh |
| row 0, col 2 | START | lights green while the service is live |
| row 0, col 3 | PAUSE / RESUME | label flips with live state; amber while paused |
| row 0, col 4 | STOP | turns red while live |
| row 1, cols 1–3 | Language keys | Russian / English / Ukrainian; the active source language lights green |

The language keys are just examples — swap the `set_source_language`
option codes (and labels) for the languages the church actually uses, or
delete them and drag fresh ones from the module's presets, which are
generated from the church's own language list.

Regenerating: export a full config from a configured Companion, then
strip it down to one page + the ChurchTranslator connection and blank
`secrets.token`. **Verify the token is gone before committing** —
Companion full exports include connection secrets in cleartext.
