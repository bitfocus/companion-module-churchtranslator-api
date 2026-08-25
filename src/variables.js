/**
 * Text for button labels: $(ct:status), $(ct:listeners), and friends.
 *
 * Definitions and values are built together from the same state so a
 * variable can never be defined-but-never-set (a blank label on a booth
 * button is worse than a wrong one — the operator can't tell whether the
 * system is broken or the value is genuinely empty).
 */

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

	return { definitions, values }
}
