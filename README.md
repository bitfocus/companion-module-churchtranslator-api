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
| Start service              | Arms the session and tells listeners to expect audio. Audio itself still comes from your capture app — this does not launch the Mac/Windows app. |
| Pause / Resume translation | Mutes and unmutes translation. Listeners stay connected; billing stops while paused.                                                             |
| Toggle pause / resume      | One button for both, driven by live state.                                                                                                       |
| Stop service               | Ends the service; the capture app stops streaming.                                                                                               |
| Set speaker's language     | A dropdown of every language the platform supports, fetched from your server so it never goes stale.                                             |
| Refresh status now         | Forces a poll. Rarely needed.                                                                                                                    |

**Feedbacks** — service is live, translation paused, listeners
connected (with a threshold), speaker's language is X, and "schedule
wants a different language" for churches whose services aren't all in
one language.

**Variables** — `status`, `listeners`, `source_language`,
`source_language_label`, `scheduled_source_language`, `engine`, `running`,
`paused`, `languages_translating`, `last_error`.

Companion prefixes these with **your connection's label**, not a fixed
module name: `$(Woodmark:status)` if the connection is called Woodmark.
Presets you drag in are rewritten to your label automatically — but a
button you build by hand, or a profile written outside Companion, is not.

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
   repo links all use that id now; the previous id lives on in the
   manifest's `legacyIds` so hand-installed tgz configs migrate.
2. Push this directory's contents to that repo.

**Every release** (including the first):

1. Bump `version` in `package.json` (`major.minor.patch`). The manifest
   version is overwritten from it at build time, so it doesn't matter.
2. Create and push a git tag prefixed with `v` — e.g. `v1.0.0`.
3. Sign in to <https://developer.bitfocus.io/> **with GitHub**, open
   **My Modules**, and submit that tag as a new version.
4. Wait for a volunteer reviewer to approve it. Approved versions become
   downloadable in Companion v4.0.0+ immediately.

Pushing a tag alone publishes nothing — only versions submitted through the
portal are reviewed. A merged pull request publishes nothing either; PRs are
how you contribute to somebody else's module.

**Before the store approval lands**, the built
`churchtranslator-api-<version>.tgz` can be handed to a church
directly and imported through Companion's "import module package", or
dropped into the developer-modules path. That is the path to use for a
demo with a fixed date — the review queue has no published SLA.

Keep the API-side contract in mind when changing anything here: the
endpoints are documented in `docs/operations.md` under "Booth control
API" in the main repo, and `services/api/tests/test_control_routes.py`
is what stops them changing under this module's feet.
