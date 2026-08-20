/**
 * Config migrations between module versions.
 *
 * One entry so far: v1.0.0 shipped the capture token as a `secret-text`
 * field, but an operator upgrading from a hand-rolled Generic HTTP
 * setup (or a pre-release build of this module) may have it sitting in
 * plain config. Move it into secrets and blank the old key, so the token
 * stops living in the exportable config file.
 *
 * Never delete an entry from this array or renumber it — Companion
 * replays them in order from whatever version a config was saved at.
 */

export const UpgradeScripts = [
	function moveTokenToSecrets(_context, props) {
		const result = { updatedConfig: null, updatedSecrets: null, updatedActions: [], updatedFeedbacks: [] }
		const config = props.config
		if (config && typeof config.token === 'string' && config.token.length > 0) {
			result.updatedSecrets = { ...(props.secrets ?? {}), token: config.token }
			result.updatedConfig = { ...config, token: '' }
		}
		return result
	},
]
