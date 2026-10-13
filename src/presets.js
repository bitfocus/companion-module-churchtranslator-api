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
 *
 * Against a server with the health read-out (2026-10-02) the language
 * buttons also carry their listener count as a second line and turn
 * amber/red when that language's translation is in trouble, and an
 * "Input meter" display key sits beside START. Against an older server
 * the presets are exactly what they were — there is nothing to show, and
 * a permanently blank second line would look like a fault.
 */
import { combineRgb } from '@companion-module/base'
import { varCode } from './health.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARK = combineRgb(20, 20, 20)
const GREEN = combineRgb(0, 130, 60)
const AMBER = combineRgb(220, 140, 0)
const RED = combineRgb(150, 30, 30)
const BLUE = combineRgb(0, 90, 160)
const PURPLE = combineRgb(96, 60, 160)
const ALARM_RED = combineRgb(200, 30, 30)
/** The on-air tally colour — the native plugin's green ring, as text. */
const LIVE_TEXT = combineRgb(62, 201, 126)

const style = (text, bgcolor, color = WHITE, size = '14') => ({ text, size, color, bgcolor })

export function buildPresets(instance, targetLanguages) {
	const presets = {}
	const health = Boolean(instance.state?.hasHealth)

	presets['status_lamp'] = {
		type: 'simple',
		name: 'Service status lamp',
		keywords: ['status', 'live', 'lamp'],
		style: style('Translation\\n$(ct:status)', DARK),
		steps: [{ down: [], up: [] }],
		feedbacks: [
			{ feedbackId: 'service_live', options: {}, style: { bgcolor: GREEN, color: WHITE } },
			{ feedbackId: 'service_starting', options: {}, style: { bgcolor: AMBER, color: BLACK } },
			{ feedbackId: 'service_paused', options: {}, style: { bgcolor: AMBER, color: BLACK } },
			// The lamp is the worst-of, as on the native plugin: a live
			// service the room can't hear is not "LIVE". Last, so it wins.
			...(health
				? [
						{
							feedbackId: 'input_alarm',
							options: { which: 'nosound' },
							style: { bgcolor: ALARM_RED, color: WHITE, text: 'NO SOUND', size: 'auto' },
						},
						{
							feedbackId: 'input_alarm',
							options: { which: 'nofeed' },
							style: { bgcolor: ALARM_RED, color: WHITE, text: 'NO FEED', size: 'auto' },
						},
					]
				: []),
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
		// Amber while the capture app hasn't collected the command yet —
		// the answer to "did my press do anything?" that stops the
		// double-press. Goes dark once the service is genuinely live, so
		// the operator reads the status lamp instead.
		feedbacks: [
			{
				feedbackId: 'service_starting',
				options: {},
				style: { bgcolor: AMBER, color: BLACK, text: 'Starting…' },
			},
			{ feedbackId: 'service_live', options: {}, style: { bgcolor: DARK, color: WHITE } },
		],
	}

	if (health) {
		// START has nothing left to do once the service is live, so on the
		// native plugin it becomes the input meter. A Companion button can't
		// change what it IS, so this is its own display key — put it next
		// to START. Calm when healthy: the on-air clock in green over a
		// moving bar. Red, with the reason, when the server hears nothing.
		presets['input_meter'] = {
			type: 'simple',
			name: 'Input meter (on-air clock + level)',
			keywords: ['meter', 'level', 'input', 'audio', 'on air', 'clock', 'no sound', 'health'],
			style: style('Input\\nmeter', DARK, WHITE, '14'),
			steps: [{ down: [], up: [] }],
			// Order matters: Companion applies feedback styles top to bottom,
			// so the alarms come last and win.
			feedbacks: [
				{ feedbackId: 'input_meter', options: {} },
				{ feedbackId: 'service_live', options: {}, style: { text: '$(ct:on_air)', size: '18', color: LIVE_TEXT } },
				{ feedbackId: 'service_paused', options: {}, style: { text: 'PAUSED', size: '14', color: AMBER } },
				{
					feedbackId: 'input_alarm',
					options: { which: 'nosound' },
					style: { bgcolor: ALARM_RED, color: WHITE, text: 'NO SOUND\\ncheck mixer', size: 'auto' },
				},
				{
					feedbackId: 'input_alarm',
					options: { which: 'nofeed' },
					style: { bgcolor: ALARM_RED, color: WHITE, text: 'NO FEED\\napp stalled', size: 'auto' },
				},
			],
		}
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
		const label = instance.labelFor(code)
		const feedbacks = [{ feedbackId: 'source_language_is', options: { code }, style: { bgcolor: GREEN, color: WHITE } }]
		if (health) {
			// After the green "being preached" lamp, so trouble wins: a
			// stalled language is the one thing on the deck worth looking at.
			feedbacks.push(
				{
					feedbackId: 'language_trouble',
					options: { code, when: 'stalled' },
					style: { bgcolor: AMBER, color: BLACK },
				},
				{
					feedbackId: 'language_trouble',
					options: { code, when: 'unavailable' },
					style: { bgcolor: ALARM_RED, color: WHITE },
				},
			)
		}
		presets[id] = {
			type: 'simple',
			name: `Speaker is preaching ${label}`,
			keywords: ['language', 'speaker', code, label],
			// With the read-out, the second line is that language's audience
			// (the name alone already says what the button sets). "Speak" on
			// every key was a word to read past to find the one that differs.
			style: health ? style(`${label}\\n$(ct:listeners_${varCode(code)})`, DARK) : style(`Speak\\n${label}`, DARK),
			steps: [{ down: [{ actionId: 'set_source_language', options: { code } }], up: [] }],
			feedbacks,
		}
	}

	const structure = [
		{
			id: 'service',
			name: 'Service control',
			description: 'Run the service from the booth. Drop the status lamp somewhere you can see it mid-sermon.',
			definitions: [
				'status_lamp',
				'listeners',
				'toggle_pause',
				'start_service',
				...(health ? ['input_meter'] : []),
				'stop_service',
			],
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
