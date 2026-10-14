/**
 * Config migrations between module versions.
 *
 * Empty: the first Bitfocus store release has no earlier published
 * version to migrate from (Bitfocus review, 2026-08-20). The one script
 * that lived here before (moving a plain-config token into secrets)
 * isn't needed for correctness either: #buildApi() still falls back to
 * a plain `config.token`.
 *
 * From the first published version on, never delete an entry from this
 * array or renumber it — Companion replays them in order from whatever
 * version a config was saved at.
 */

export const UpgradeScripts = []
