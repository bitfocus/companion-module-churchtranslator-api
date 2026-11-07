/**
 * What the buttons LOOK LIKE.
 *
 * Every callback reads instance.state — the last good poll — and never
 * makes a request: Companion evaluates feedbacks often and expects them
 * to be instant, and a booth's internet dropping mid-service must not
 * freeze the surface.
 *
 * Colour choices follow the room, not a palette: green means audio is
 * genuinely reaching listeners, amber means the operator paused on
 * purpose, and "not live" is left dark rather than red — a service that
 * hasn't started yet isn't an error.
 */
import { combineRgb } from '@companion-module/base'
import { inputView, meterValue } from './health.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREEN = combineRgb(0, 130, 60)
const AMBER = combineRgb(220, 140, 0)
const BLUE = combineRgb(0, 90, 160)
const PURPLE = combineRgb(96, 60, 160)
const ALARM_RED = combineRgb(200, 30, 30)

/** The language dropdown both language feedbacks share. */
function languageOption(instance, fallbackDefault) {
	return {
		type: 'dropdown',
		id: 'code',
		label: 'Language',
		default: fallbackDefault ?? instance.languageChoices?.[0]?.id ?? 'en',
		choices: instance.languageChoices?.length
			? instance.languageChoices
			: [
					{ id: 'en', label: 'English (en)' },
					{ id: 'ru', label: 'Russian (ru)' },
				],
		allowCustom: true,
		regex: '/^[a-zA-Z]{2,3}$/',
	}
}

export function buildFeedbacks(instance) {
	return {
		service_live: {
			type: 'boolean',
			name: 'Service is live',
			description: 'True while a capture app is streaming and translation is not paused.',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => instance.state.running && !instance.state.paused,
		},

		service_starting: {
			type: 'boolean',
			name: 'Service is starting',
			description:
				'True in the window between pressing Start and the capture app actually streaming — the server has left the ' +
				'start command for the app to collect on its next poll. Falls back to not-live if nothing collects it, so a ' +
				'closed or signed-out capture app never shows as started.',
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [],
			callback: () => !instance.state.running && instance.state.remoteStartPending,
		},

		service_paused: {
			type: 'boolean',
			name: 'Translation paused',
			description: 'True while the service is streaming but translation is muted.',
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [],
			callback: () => instance.state.running && instance.state.paused,
		},

		has_listeners: {
			type: 'boolean',
			name: 'Listeners connected',
			description: 'True when at least N phones are listening — proof the congregation is actually hearing it.',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				{
					type: 'number',
					id: 'min',
					label: 'At least this many listeners',
					default: 1,
					min: 1,
					max: 10000,
				},
			],
			callback: (feedback) => instance.state.listeners >= (Number(feedback.options.min) || 1),
		},

		source_language_is: {
			type: 'boolean',
			name: "Speaker's language is",
			description: 'Lights the language button that is currently selected.',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [languageOption(instance)],
			callback: (feedback) =>
				String(feedback.options.code || '').toLowerCase() === String(instance.state.sourceLanguage).toLowerCase(),
		},

		schedule_pending: {
			type: 'boolean',
			name: 'Schedule wants a different language',
			description:
				"True when the church's service schedule would switch the speaker language for a session starting now, but the current setting is something else. Useful as a 'check me' lamp before a bilingual Sunday.",
			defaultStyle: { bgcolor: PURPLE, color: WHITE },
			options: [],
			callback: () => {
				const due = instance.state.scheduledSourceLanguage
				return Boolean(due) && due !== instance.state.sourceLanguage
			},
		},

		// --- The health read-out (servers from 2026-10-02) -----------------
		// All three read state the poll and the meter socket keep current.
		// Against an older server they simply never light — there is
		// nothing to report, which is not the same as something wrong.

		language_trouble: {
			type: 'boolean',
			name: 'Language in trouble',
			description:
				"True while that language's translation is stalled (amber by default), or — pick it below — when no " +
				'translation engine can serve it at all (use red for that one). Put both on a language button.',
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [
				languageOption(instance, instance.targetLanguages?.[0]?.code),
				{
					type: 'dropdown',
					id: 'when',
					label: 'Light when',
					default: 'stalled',
					disableAutoExpression: true,
					choices: [
						{ id: 'stalled', label: 'Translation stalled' },
						{ id: 'unavailable', label: 'No engine can serve it' },
						{ id: 'either', label: 'Either' },
					],
				},
			],
			callback: (feedback) => {
				const s = instance.state
				if (!s.reachable || !s.hasHealth) return false
				const code = String(feedback.options.code || '').toLowerCase()
				const health = s.languageHealth?.[code]
				const when = feedback.options.when || 'stalled'
				if (when === 'either') return health === 'stalled' || health === 'unavailable'
				return health === when
			},
		},

		input_alarm: {
			type: 'boolean',
			name: 'Input alarm (NO SOUND / NO FEED)',
			description:
				'True while the service is live but the server hears nothing: NO SOUND when audio keeps arriving but has ' +
				'been silent for 15 s (aux send down, wrong input picked), NO FEED when the capture app is connected but ' +
				'its audio stopped arriving for over 5 s. Never while paused — a paused app sends no audio on purpose.',
			defaultStyle: { bgcolor: ALARM_RED, color: WHITE },
			options: [
				{
					type: 'dropdown',
					id: 'which',
					label: 'Alarm',
					default: 'any',
					disableAutoExpression: true,
					choices: [
						{ id: 'any', label: 'Either' },
						{ id: 'nosound', label: 'NO SOUND (silent input)' },
						{ id: 'nofeed', label: 'NO FEED (audio stopped arriving)' },
					],
				},
			],
			callback: (feedback) => {
				const mode = inputView(instance.state, instance.meter).mode
				const which = feedback.options.which || 'any'
				if (which === 'any') return mode === 'nosound' || mode === 'nofeed'
				return mode === which
			},
		},

		// The meter's value, drawn by the "Input level meter" element
		// (composites.js). It replaced 1.3's advanced "input_meter"
		// feedback, which painted the bar into an image buffer; buttons
		// saved with that one lose their bar and need the preset again.
		input_level: {
			type: 'value',
			name: 'Input level (for the level meter)',
			description:
				'The input level meter as { mode, lit, hold }: mode is live / paused / nosound / nofeed / off / unknown, ' +
				'lit is how many of the 10 segments the level lights, hold is the 2-second peak-hold segment (0 = none). ' +
				'What the SERVER hears, ten updates a second while the service is live. Put it in a local variable and ' +
				'feed the "Input level meter" element from it — the Input meter preset does both.',
			options: [],
			// Module API 2.x has no feedback subscribe callback: the callback
			// runs when a feedback is placed (and on every recheck), and
			// unsubscribe when it is removed — so that pair is how the module
			// knows whether anyone is looking at a meter, and opens the
			// meter socket only then.
			callback: (feedback) => {
				instance.meterFeedbackSeen?.(feedback.id)
				return meterValue(inputView(instance.state, instance.meter))
			},
			unsubscribe: (feedback) => {
				instance.meterFeedbackGone?.(feedback.id)
			},
		},
	}
}
