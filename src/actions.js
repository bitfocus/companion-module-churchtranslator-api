/**
 * What the buttons DO.
 *
 * The language actions come in two shapes on purpose:
 *   set_source_language  — a dropdown, for the common "one button per
 *                          language we preach in" setup;
 *   set_source_language_custom — a text field that accepts variables, so
 *                          a language can come from another button, a
 *                          companion variable, or a triggered automation.
 *
 * Every callback goes through instance.runAction, which polls straight
 * after so the button's own feedback updates without waiting a tick.
 */

export function buildActions(instance) {
	const languageChoices = instance.languageChoices?.length
		? instance.languageChoices
		: // Before the roster loads (or if the API is unreachable at init)
			// offer something sane rather than an empty, unusable dropdown.
			[
				{ id: 'en', label: 'English (en)' },
				{ id: 'ru', label: 'Russian (ru)' },
				{ id: 'uk', label: 'Ukrainian (uk)' },
				{ id: 'es', label: 'Spanish (es)' },
			]

	return {
		start_service: {
			name: 'Start service',
			description:
				'Tells listeners to expect audio and asks your capture app to start streaming. It picks this up within a few seconds if it is open and signed in.',
			options: [],
			callback: async () => instance.runAction('Start service', () => instance.api.start()),
		},

		pause_translation: {
			name: 'Pause translation',
			description: 'Mutes translation. Listeners stay connected and billing stops.',
			options: [],
			callback: async () => instance.runAction('Pause translation', () => instance.api.pause()),
		},

		resume_translation: {
			name: 'Resume translation',
			options: [],
			callback: async () => instance.runAction('Resume translation', () => instance.api.resume()),
		},

		toggle_pause: {
			name: 'Toggle pause / resume',
			description: 'One button for both, using the live state. Pair it with the "Translation paused" feedback.',
			options: [],
			callback: async () =>
				instance.state.paused
					? instance.runAction('Resume translation', () => instance.api.resume())
					: instance.runAction('Pause translation', () => instance.api.pause()),
		},

		stop_service: {
			name: 'Stop service',
			description: 'Ends the service — the capture app stops streaming.',
			options: [],
			callback: async () => instance.runAction('Stop service', () => instance.api.stop()),
		},

		set_source_language: {
			name: "Set speaker's language",
			description:
				'The language being preached. Press between services: a service already streaming keeps the language it started with.',
			options: [
				{
					type: 'dropdown',
					id: 'code',
					label: 'Language',
					default: languageChoices[0]?.id ?? 'en',
					choices: languageChoices,
					allowCustom: true,
					// Any 2-3 letter code; the server is the real validator and
					// rejects unknown ones with a message we log.
					regex: '/^[a-zA-Z]{2,3}$/',
				},
			],
			callback: async (action) => {
				const code = String(action.options.code || '').trim()
				const result = await instance.runAction(`Set speaker language to ${code}`, () =>
					instance.api.setSourceLanguage(code),
				)
				// Say out loud when a live service didn't take the change —
				// otherwise the operator presses RU mid-sermon and believes it.
				if (result && result.appliedToLiveSession === false) {
					instance.log(
						'warn',
						`Speaker language is now ${result.sourceLanguage}, but a service is already streaming — ` +
							'it keeps the language it started with. The change applies to the next service.',
					)
				}
			},
		},

		// There WAS a second action here, "Set speaker's language (from a
		// variable)", which called context.parseVariablesInString(). That
		// method does not exist in module API 2.x — the action threw a
		// TypeError on every press. It was also redundant: every input field
		// in 2.x is expression-capable unless it opts out with
		// disableAutoExpression, so the dropdown above already drives from a
		// variable via its expression mode. Removed rather than repaired.

		refresh_status: {
			name: 'Refresh status now',
			description: 'Forces an immediate poll. Rarely needed — the module polls on its own.',
			options: [],
			callback: async () => instance.poll(),
		},
	}
}
