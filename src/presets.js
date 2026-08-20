/**
 * Ready-made buttons.
 *
 * A volunteer sound operator should be able to drag four buttons onto a
 * deck and run a service, without knowing what a feedback is. So each
 * preset ships with its own feedback wiring already attached — the
 * pause button is amber while paused, the status lamp is green while
 * audio is genuinely reaching phones.
 *
 * The language buttons are generated from the church's OWN enabled
 * languages (fetched from the API) rather than a guess at popular ones:
 * a Ukrainian congregation should not have to delete a Spanish preset.
 * The speaker's current language is included even if it isn't a
 * translation target — it is the one they most need a button for.
 */
import { combineRgb } from '@companion-module/base'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARK = combineRgb(20, 20, 20)
const GREEN = combineRgb(0, 130, 60)
const AMBER = combineRgb(220, 140, 0)
const RED = combineRgb(150, 30, 30)
const BLUE = combineRgb(0, 90, 160)
const PURPLE = combineRgb(96, 60, 160)

const style = (text, bgcolor, color = WHITE, size = '14') => ({ text, size, color, bgcolor })

export function buildPresets(instance, targetLanguages) {
	const presets = {}

	presets['status_lamp'] = {
		type: 'simple',
		name: 'Service status lamp',
		keywords: ['status', 'live', 'lamp'],
		style: style('Translation\\n$(ct:status)', DARK),
		steps: [{ down: [], up: [] }],
		feedbacks: [
			{ feedbackId: 'service_live', options: {}, style: { bgcolor: GREEN, color: WHITE } },
			{ feedbackId: 'service_paused', options: {}, style: { bgcolor: AMBER, color: BLACK } },
		],
	}

	presets['listeners'] = {
		type: 'simple',
		name: 'Listeners connected',
		keywords: ['listeners', 'audience'],
		style: style('Listening\\n$(ct:listeners)', DARK),
		steps: [{ down: [], up: [] }],
		feedbacks: [{ feedbackId: 'has_listeners', options: { min: 1 }, style: { bgcolor: BLUE, color: WHITE } }],
	}

	presets['toggle_pause'] = {
		type: 'simple',
		name: 'Pause / resume translation',
		keywords: ['pause', 'resume', 'mute'],
		style: style('Pause\\ntranslation', DARK),
		steps: [{ down: [{ actionId: 'toggle_pause', options: {} }], up: [] }],
		feedbacks: [
			{
				feedbackId: 'service_paused',
				options: {},
				style: { bgcolor: AMBER, color: BLACK, text: 'PAUSED\\ntap to resume' },
			},
		],
	}

	presets['start_service'] = {
		type: 'simple',
		name: 'Start service',
		keywords: ['start'],
		style: style('Start\\nservice', GREEN),
		steps: [{ down: [{ actionId: 'start_service', options: {} }], up: [] }],
		feedbacks: [],
	}

	presets['stop_service'] = {
		type: 'simple',
		name: 'Stop service',
		keywords: ['stop', 'end'],
		style: style('Stop\\nservice', RED),
		steps: [{ down: [{ actionId: 'stop_service', options: {} }], up: [] }],
		feedbacks: [],
	}

	presets['speaker_language_now'] = {
		type: 'simple',
		name: "Speaker's language (display only)",
		keywords: ['language', 'speaker', 'source'],
		style: style('Speaking\\n$(ct:source_language_label)', DARK),
		steps: [{ down: [], up: [] }],
		feedbacks: [
			{
				feedbackId: 'schedule_pending',
				options: {},
				style: { bgcolor: PURPLE, color: WHITE, text: 'Schedule wants\\n$(ct:scheduled_source_language)' },
			},
		],
	}

	// One "speak this language" button per language this church uses.
	const codes = []
	for (const entry of targetLanguages || []) {
		if (entry?.code && !codes.includes(entry.code)) codes.push(entry.code)
	}
	const current = instance.state?.sourceLanguage
	if (current && !codes.includes(current)) codes.unshift(current)

	const languagePresetIds = []
	for (const code of codes) {
		const id = `speak_${code}`
		languagePresetIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Speaker is preaching ${instance.labelFor(code)}`,
			keywords: ['language', 'speaker', code, instance.labelFor(code)],
			style: style(`Speak\\n${instance.labelFor(code)}`, DARK),
			steps: [{ down: [{ actionId: 'set_source_language', options: { code } }], up: [] }],
			feedbacks: [{ feedbackId: 'source_language_is', options: { code }, style: { bgcolor: GREEN, color: WHITE } }],
		}
	}

	const structure = [
		{
			id: 'service',
			name: 'Service control',
			description: 'Run the service from the booth. Drop the status lamp somewhere you can see it mid-sermon.',
			definitions: ['status_lamp', 'listeners', 'toggle_pause', 'start_service', 'stop_service'],
		},
		{
			id: 'language',
			name: "Speaker's language",
			description:
				'One button per language your speakers use — the lit one is active. Press between services: a service already streaming keeps the language it started with.',
			definitions: ['speaker_language_now', ...languagePresetIds],
		},
	]

	return { structure, presets }
}
