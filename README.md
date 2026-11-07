# ChurchTranslator.AI — Bitfocus Companion module

Run live sermon translation from the booth's Stream Deck: start, pause,
resume and stop the service, switch the language the preacher is
speaking, and see the real service state on the buttons.

This is a proper Companion **connection** (a module listed under
Add connection), not the Generic HTTP recipe on the dashboard. Same API
underneath — the difference is typed actions, button feedback, variables
and ready-made presets instead of hand-built URLs.

## Setting it up

1. In the ChurchTranslator.AI dashboard, open **Connected devices →
   Booth control** and click **Mint a "Booth Stream Deck" token**. A
   dedicated token means you can revoke the deck without touching the
   Macs that stream audio.
2. In Companion, **Connections → Add connection → ChurchTranslator.AI**.
3. Fill in:
   - **Server URL** — from the Booth control card
     (`https://api.churchtranslator.ai` for most churches).
   - **Capture token** — the token you just minted.
   - **Session name** — leave as `Sunday`.
4. Open **Presets → ChurchTranslator.AI** and drag the buttons you want.
   The language buttons are generated from the languages _your_ church
   uses, so there's nothing to delete.

If the connection turns red with "Capture token rejected", the token was
revoked — mint a new one on the same dashboard card.

## What you get

**Actions**

| Action                     | Notes                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start service              | Tells listeners to expect audio and asks your capture app to start streaming: it collects the request within a few seconds if it is open, signed in and lets the booth start it (Mac 0.7.4+, Windows 0.8.2+). It does not open a closed app. |
| Pause / Resume translation | Mutes and unmutes translation. Listeners stay connected; billing stops while paused.                                                             |
| Toggle pause / resume      | One button for both, driven by live state.                                                                                                       |
| Stop service               | Ends the service; the capture app stops streaming.                                                                                               |
| Set speaker's language     | A dropdown of every language the platform supports, fetched from your server so it never goes stale.                                             |
| Refresh status now         | Forces a poll. Rarely needed.                                                                                                                    |

**Feedbacks** — service is live, service is starting (START pressed,
capture app not streaming yet), translation paused, listeners
connected (with a threshold), speaker's language is X, and "schedule
wants a different language" for churches whose services aren't all in
one language. Plus the health read-out's language in trouble, input
alarm and input level meter (below).

**Variables** — `status`, `listeners`, `source_language`,
`source_language_label`, `scheduled_source_language`, `engine`, `running`,
`paused`, `starting`, `languages_translating`, `last_error` — and, against a server
with the health read-out, the ones listed below.

Companion prefixes these with **your connection's label**, not a fixed
module name: `$(Woodmark:status)` if the connection is called Woodmark.
Presets you drag in are rewritten to your label automatically — but a
button you build by hand, or a profile written outside Companion, is not.

## Health read-out (1.2.0)

The Companion side of the native Stream Deck plugin's 1.4.0 read-out,
with the same thresholds, so two decks in one booth raise the same alarm
at the same moment. Problems are shown by exception.

- **Language preset buttons** carry that language's listener count as a
  second line (`$(ct:listeners_ru)`: cloud + Local Wi-Fi relay phones),
  and turn amber while its translation is stalled / red when no engine
  can serve it — the **Language in trouble** feedback, placed twice
  (`when: stalled`, `when: unavailable`).
- **Input meter** preset, for the key beside START: the on-air clock
  (`$(ct:on_air)`) over a level meter — ten segments at dB steps
  −60 … −3, OBS colours (red ≥ −9, yellow ≥ −20, green below), 2 s peak
  hold, 20 dB/s release — and the **Input alarm** feedback: NO SOUND
  after 15 s of silent audio, NO FEED after 5 s without frames, nothing
  while paused. Since 1.4.0 Companion draws the meter (below).
- **Variables**: `total_listeners`, `on_air`, `input_peak_db`,
  `input_state` (live / paused / off / nosound / nofeed / unknown), and
  `listeners_<code>` / `health_<code>` for the church's own languages,
  the one being preached, and any the server reports.

Where it comes from: `/status` on servers from 2026-10-02 carries
`totalListeners`, `listenersByLanguage`, `languageHealth`, `startedAt`
and `input` (a 1-second level). For the meter, `WS
/v1/control/{session}/meter` pushes a reading every 100 ms; the module
opens it (token in the `Authorization` header, not the URL) only while
the server has the read-out, the service is live and unpaused, and an
Input level feedback is in use — module API 2.x has no feedback
`subscribe`, so that feedback's callback/`unsubscribe` pair is the signal.
Backoff 2 s, 4 s … 60 s (30 s on 4429, the 8-sockets-per-church cap),
reset by a reading. Redraws are capped at 10/s and skipped unless a
segment changed; a socket quiet for 1.5 s hands back to the poll's level.

Against an older server (`listenersByLanguage` absent) the module
behaves as 1.1 did: no new variables, the old presets, no socket. (The
three new feedbacks are listed, and never light.)

The downloadable per-church `.companionconfig` (the dashboard's Booth
control card) is built server-side from its own copy of
`templates/translator-page.companionconfig`, plus the health buttons
(`services/api/app/data/companion_health_additions.json`, exported from
a real Companion running this module's presets). They are on by
default, since the card hands out this module itself;
`CT_COMPANION_HEALTH_PRESETS=0` on the API leaves them out (a booth still
on 1.1). Since 2026-11-03 the card hands out 1.4.0, and that meter key
(and the one in this directory's `templates/translator-page.companionconfig`)
is 1.4.0's layered key below, exported from a Companion 5.0.3 running the
Input meter preset — with one change: the composite element is inlined as
a group of its ten boxes, because an imported composite draws nothing (the
third trap below). A booth still on 1.2.0–1.3.2 that imports it gets the
key's label, clock and alarms but no bar.

### How the meter is drawn (1.4.0)

Until 1.3.2 the meter was an advanced feedback that painted the bar into
the button's image buffer. Bitfocus's review of 1.3.1 (M2) noted that
advanced feedbacks will likely go in a future major API version, so from
1.4.0 Companion draws it with module API 2.1's graphics:

- **Input level** (`input_level`), a _value_ feedback, returns
  `{ mode, lit, hold }` — the meter state, the segments the level lights,
  and the peak-hold segment. Segment counts rather than dB, so the value
  only changes when a segment does.
- **Input level meter** (`input_meter`), a _composite element_
  (`src/composites.js`): ten boxes whose colour and opacity are
  expressions over its `mode` / `lit` / `hold` options. Unlit segments
  stay faint; NO SOUND / NO FEED draw a white unlit scale; off and
  unknown draw nothing.
- The **Input meter** preset is `layered`: a background box, the label,
  and the element along the bottom, its options bound to
  `$(local:level).mode` etc. — a `feedback` local variable on the button
  driven by Input level. Clock and alarms are style overrides on the
  label and background. A `simple` variant (the same key without the
  bar) rides along as the preset's alternative for hosts that can't draw
  layered buttons.

Checked in a real Companion 5.0.3 (headless with a scratch config, a mock
control API, the preset dragged onto a button): the key draws as the
bitmap did — level, peak hold, release, paused, NO SOUND / NO FEED, and
nothing when stopped — and the meter socket opens when the key is placed
and closes when it is cleared. Two traps on the way:

- a layered preset's `styleOverrides[].override` must be the full
  `{ isExpression, value }`: 5.0.x silently drops a bare value, and the
  whole feedback with it (seen in 5.0.3; 5.1 accepts either);
- a composite option that a preset binds with an expression must not set
  `disableAutoExpression` — Companion's element converter turns such an
  option's expression back into plain text (from its source, not tried);
- an imported composite draws nothing: Companion's import gives the
  connection a new id and rewrites it in actions, feedbacks and local
  variables, but not in a layer's `connectionId` (seen in 5.0.3 with the
  dashboard download, both Full Import and the Buttons tab;
  `VisitorReferencesBase.visitDrawElements` is the same in 5.1.1 and on
  `main`). A key built from the preset loses its bar when its page is
  exported and imported elsewhere; the dashboard download therefore inlines
  the element (a group whose boxes read `$(local:level)` directly), which
  imports, draws and exports back unchanged.

**Buttons saved with 1.2.0–1.3.2's meter** (the old `input_meter`
advanced feedback — including the meter key of a dashboard download made
before 2026-11-03) lose
the bar on 1.4.0; their clock and alarms are separate feedbacks and keep
working. No upgrade script can fix that: upgrade scripts can only change
a feedback's id and options, not add elements or local variables to a
button. Delete the key and drag the Input meter preset again.

## The one thing worth knowing about language buttons

The translation engine takes the speaker's language when it opens its
connections at the start of a service, and it can't be re-pointed
mid-stream. So:

- Pressing a language button **between services** applies to the next
  service — this is the normal use, and how a bilingual church runs a
  Russian 9am and an English 11am.
- Pressing one **mid-sermon** changes the setting, but _this_ service
  keeps the language it started with. The module logs a warning when
  that happens rather than letting you believe it switched.
- Unless the button's **Switch the running service now** box is ticked
  (1.3.0, off by default): then the press also restarts the running
  service's translation on the new language. The capture app reconnects
  within seconds and listeners hear a short pause. Tick it on the buttons
  the booth uses to fix a service that started on the wrong language.

If your services always run in the same order, you can skip the buttons
entirely: set the speaker language per service under **Service
schedules** in the dashboard and the server switches it when capture
starts.

## Security

The capture token drives audio ingest and billing for one church, so
Companion stores it as a **secret** — encrypted at rest and never shown
back to you in the GUI. **But a full config export still contains it in
cleartext** (verified against a real Companion 4.x export): treat an
exported `.companionconfig` like the token itself — move it on a USB
stick or AirDrop, not email or chat, and revoke + re-mint the token if
an export gets loose. The token names exactly one church server-side,
so this module structurally cannot address another church's service.

## Development

```bash
yarn install
yarn test              # unit tests, no Companion needed
yarn check             # syntax check every source file
yarn companion-module-build   # produce the distributable package
```

**Use yarn, not npm.** Bitfocus's shared CI hard-fails if a
`package-lock.json` appears or `yarn.lock` is missing, and their packaging
tool refuses to run under Yarn PnP — hence the committed `.yarnrc.yml`
pinning `nodeLinker: node-modules`.

To try it in Companion before it is published, build it and drop the
result into your Companion "developer modules" path (Companion →
Settings → Developer modules path), then restart Companion.

To exercise it against a **real server** without installing Companion at
all, `tools/smoke.mjs` stands in for the host: it constructs the actual
instance class with a fake host context, runs `init()`, and prints the
actions, feedbacks, presets and variables it produced — then flips the
speaker language and reads it back.

```bash
node tools/smoke.mjs <capture-token> https://api.dev.churchtranslator.ai
```

Point it at dev, never at a church's live service: it changes the
speaker language for real (it puts it back, but a service running at the
time would still see the write).

Requires `@companion-module/base` v2 (module API 2.1.x): the entrypoint
exports the instance class as its **default export** plus a named
`UpgradeScripts` — there is no `runEntrypoint()` in v2, despite what the
older JS template on GitHub still shows.

### Publishing to Bitfocus

The module source lives in the ChurchTranslator.AI monorepo
(`integrations/companion-module-churchtranslator/`) so it stays in step
with the control API it drives. Bitfocus distributes from a repo in
**their** GitHub org, and publishing a version is a manual click in their
developer portal — there is no token, CLI, or API for it.

**First release** (once only):

1. Post in the Bitfocus `#module-development` Slack channel
   ([invite](https://bfoc.us/54brzjjkk9)) asking for a repository, giving
   your GitHub username and the module name. DONE 2026-08: we proposed the
   manufacturer-product form, Bitfocus staff chose **`churchtranslator-api`**
   and created `bitfocus/companion-module-churchtranslator-api` (invite
   accepted, write access confirmed). The module id/name, package name, and
   repo links all use that id now. The manifest keeps `legacyIds` empty
   and `version` at "0.0.0" (the build fills it in from package.json),
   as Bitfocus's 2026-08-20 review asked.
2. Push this directory's contents to that repo.

**Every release** (including the first):

1. Bump `version` in `package.json` (`major.minor.patch`). The manifest
   version is overwritten from it at build time, so it doesn't matter.
2. Create and push a git tag prefixed with `v` — e.g. `v1.0.0`. A tag
   that was already submitted is frozen: fix forward with a new version.
   Publishing a GitHub release on the tag runs `release.yaml`, which
   attaches the built `.tgz` to the release.
3. Sign in to <https://developer.bitfocus.io/> **with GitHub**, open
   **My Modules**, and submit that tag as a new version.
4. Wait for a volunteer reviewer to approve it. Approved versions become
   downloadable immediately in Companion 5.0+ (module API 2.1 needs it).

Keep `.prettierignore`, `.github/workflows/` and the manifest's
`runtime.type` exactly as in Bitfocus's
[`companion-module-template-js`](https://github.com/bitfocus/companion-module-template-js):
the review diffs them against the template and blocks on any difference
(review of v1.3.1, 2026-10-30). Every Companion 5.x bundles the Node 26
runtime the template sets.

Pushing a tag alone publishes nothing — only versions submitted through the
portal are reviewed. A merged pull request publishes nothing either; PRs are
how you contribute to somebody else's module.

**A version the store doesn't have yet** can be handed to a church
directly: the built `churchtranslator-api-<version>.tgz`, imported through
Companion's "import module package" or dropped into the developer-modules
path. That is the path to use for a demo with a fixed date — the review
queue has no published SLA. It installs beside any older version, and a
connection that already exists stays on its version until its Module
Version is changed by hand.

Keep the API-side contract in mind when changing anything here: the
endpoints are documented in `docs/operations.md` under "Booth control
API" in the main repo, and `services/api/tests/test_control_routes.py`
is what stops them changing under this module's feet.
