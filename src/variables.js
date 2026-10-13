/**
 * Text for button labels: $(ct:status), $(ct:listeners), and friends.
 *
 * Definitions and values are built together from the same state so a
 * variable can never be defined-but-never-set (a blank label on a booth
 * button is worse than a wrong one — the operator can't tell whether the
 * system is broken or the value is genuinely empty).
 *
 * The health read-out's variables (total_listeners, on_air, input_*, and
 * listeners_<code> / health_<code> per language) exist only once the
 * server has shown it serves them. Against an older server the list is
 * exactly what it always was, rather than a row of permanently blank
 * entries that look like a fault.
 */
import { inputView, onAirText, varCode } from './health.js'

/**
 * The languages that get their own listeners_/health_ variables: the
 * church's own translation languages, the one being preached, and any
 * the server reports — so a language nobody configured but someone is
 * listening to is never silently dropped. Sorted, so the definition list
 * is stable from poll to poll.
 */
export function healthLanguageCodes(instance) {
	const s = instance.state
	const codes = new Set()
	for (const entry of instance.targetLanguages || []) if (entry?.code) codes.add(entry.code)
	if (s.sourceLanguage) codes.add(s.sourceLanguage)
	for (const code of Object.keys(s.listenersByLanguage || {})) codes.add(code)
	for (const code of Object.keys(s.languageHealth || {})) codes.add(code)
	return [...codes].filter((c) => varCode(c)).sort()
}

/** Rounded dBFS for a label, blank when there's no level to report. */
export const peakText = (view) => (view.peakDb === null ? '' : Math.round(view.peakDb))

export function buildVariables(instance) {
	const s = instance.state

	const definitions = {
		status: { name: 'Service status (Live / Paused / Starting / Offline / Unreachable)' },
		running: { name: 'Capture streaming (true/false)' },
		paused: { name: 'Translation paused (true/false)' },
		starting: { name: 'Start pressed, capture app not yet streaming (true/false)' },
		listeners: { name: 'Listeners connected right now' },
		source_language: { name: "Speaker's language code (e.g. ru)" },
		source_language_label: { name: "Speaker's language name (e.g. Russian)" },
		scheduled_source_language: { name: 'Language the schedule would switch to now (blank if none)' },
		engine: { name: 'Translation engine (Natural Voice / Live Interpreter)' },
		languages_translating: { name: 'How many languages are being translated right now' },
		last_error: { name: 'Last error message (blank when healthy)' },
	}

	const values = {
		// "Starting" sits between Offline and Live: the start command is
		// waiting for the capture app's poll. Without it the lamp jumps
		// Offline → Live with nothing in between, and an operator who
		// pressed Start four seconds ago presses it again.
		status: !s.reachable
			? 'Unreachable'
			: s.running
				? s.paused
					? 'Paused'
					: 'Live'
				: s.remoteStartPending
					? 'Starting'
					: 'Offline',
		running: s.running ? 'true' : 'false',
		paused: s.paused ? 'true' : 'false',
		starting: !s.running && s.remoteStartPending ? 'true' : 'false',
		listeners: s.listeners,
		source_language: s.sourceLanguage,
		source_language_label: instance.labelFor(s.sourceLanguage),
		scheduled_source_language: s.scheduledSourceLanguage,
		// The wire values are the internal engine names; booth operators
		// know these by their product names, which is what the dashboard
		// and every support conversation uses.
		engine: s.voiceMode === 'gemini' ? 'Natural Voice' : s.voiceMode === 'dynamic' ? 'Live Interpreter' : s.voiceMode,
		languages_translating: Object.keys(s.perLangMinutes || {}).length,
		last_error: s.lastError || '',
	}

	if (s.hasHealth) {
		const view = inputView(s, instance.meter)
		definitions.total_listeners = { name: 'Listeners right now, including phones on the Local Wi-Fi relay' }
		definitions.on_air = { name: 'Time on air (42:13, 1:02:13; blank when not live)' }
		definitions.input_peak_db = { name: 'Input peak the server hears, dBFS (blank when not live)' }
		definitions.input_state = { name: 'Input: live / paused / off / nosound / nofeed / unknown' }
		values.total_listeners = s.totalListeners
		values.on_air = onAirText(s)
		values.input_peak_db = peakText(view)
		values.input_state = view.mode
		for (const code of healthLanguageCodes(instance)) {
			const id = varCode(code)
			const label = instance.labelFor(code)
			definitions[`listeners_${id}`] = { name: `Listeners on ${label} (${code})` }
			definitions[`health_${id}`] = {
				name: `${label} translation: translating / idle / holding / stalled / unavailable (blank when not running; holding = music or noise, not a fault)`,
			}
			values[`listeners_${id}`] = Number(s.listenersByLanguage?.[code]) || 0
			values[`health_${id}`] = s.languageHealth?.[code] || ''
		}
	}

	return { definitions, values }
}
