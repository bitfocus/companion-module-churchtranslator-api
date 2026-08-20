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

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREEN = combineRgb(0, 130, 60)
const AMBER = combineRgb(220, 140, 0)
const BLUE = combineRgb(0, 90, 160)
const PURPLE = combineRgb(96, 60, 160)

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
			options: [
				{
					type: 'dropdown',
					id: 'code',
					label: 'Language',
					default: instance.languageChoices?.[0]?.id ?? 'en',
					choices: instance.languageChoices?.length
						? instance.languageChoices
						: [
								{ id: 'en', label: 'English (en)' },
								{ id: 'ru', label: 'Russian (ru)' },
							],
					allowCustom: true,
					regex: '/^[a-zA-Z]{2,3}$/',
				},
			],
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
	}
}
