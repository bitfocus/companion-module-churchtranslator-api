/**
 * ChurchTranslator.AI — Bitfocus Companion connection.
 *
 * Puts a church's live translation on the booth's Stream Deck: start,
 * pause, resume and stop the service, and switch the language the
 * preacher is speaking (a bilingual church runs Russian at 09:00 and
 * English at 11:00). Buttons light up from the real service state, so
 * the operator can see at a glance that translation is actually live.
 *
 * Talks to the same capture-token-authed control API as the dashboard's
 * Generic-HTTP cheat sheet; this module exists so operators get typed
 * actions, button feedback and variables instead of hand-built URLs.
 *
 * SHAPE OF THE THING
 *   api.js       — every HTTP call, and nothing else
 *   actions.js   — what buttons DO
 *   feedbacks.js — what buttons LOOK LIKE (driven by the poll below)
 *   variables.js — text for button labels ($(ct:listeners) etc.)
 *   presets.js   — ready-made buttons so a new user isn't staring at a
 *                  blank config
 *
 * One poll loop drives feedbacks and variables. Companion asks for
 * feedback synchronously and often, so every feedback callback reads
 * this.state — a plain object refreshed on a timer — rather than making
 * its own request.
 */
import { InstanceBase, InstanceStatus } from '@companion-module/base'
import { ApiError, ControlApi } from './api.js'
import { UpgradeScripts } from './upgrades.js'
import { buildActions } from './actions.js'
import { buildFeedbacks } from './feedbacks.js'
import { buildVariables } from './variables.js'
import { buildPresets } from './presets.js'

// Module API v2 boots a connection by importing this file: Companion
// reads the default export (the instance class) and the named
// UpgradeScripts export, and constructs the instance itself. (The older
// runEntrypoint() call is gone in v2 — @companion-module/base no longer
// exports it, though the JS template on GitHub still shows it.)
export { UpgradeScripts }

/** Polls slower than this and a button lags the room; faster and a busy
 * Sunday makes needless traffic. Operators can override in config. */
const DEFAULT_POLL_SECONDS = 3
const MIN_POLL_SECONDS = 1
const MAX_POLL_SECONDS = 60
/** Ceiling for the failure backoff — a dead server is retried once a minute. */
const MAX_BACKOFF_SECONDS = 60
/** How often to re-probe an endpoint the server said it doesn't have. */
const LANGUAGE_RETRY_MS = 5 * 60 * 1000

export default class ChurchTranslatorInstance extends InstanceBase {
	constructor(internal) {
		super(internal)

		/**
		 * Everything the buttons read. Deliberately a snapshot of the last
		 * good poll: feedbacks must answer instantly and must not throw
		 * when the church's internet drops mid-service.
		 */
		this.state = {
			reachable: false,
			running: false,
			paused: false,
			/** START pressed, capture app hasn't picked it up yet. */
			remoteStartPending: false,
			listeners: 0,
			voiceMode: '',
			sourceLanguage: '',
			scheduledSourceLanguage: '',
			perLangMinutes: {},
			lastError: '',
		}
		/** code -> English label, from the API so it can't go stale here. */
		this.languageLabels = {}
		/** Dropdown contents for the "Set speaker language" action. */
		this.languageChoices = []
		/** The church's own translated languages — one preset button each. */
		this.targetLanguages = []
		/** Which speaker language the current presets were built for, so a
		 * switch can rebuild them (see poll). */
		this.presetsBuiltFor = null
		/** True when the server has no speaker-language endpoints (older
		 * than this module). Logged once, not every poll. */
		this.languageApiMissing = false
		/** When that was last established, so it can be re-probed. */
		this.languageApiMissingAt = 0
		/** In-flight poll, so overlapping callers share one request pair. */
		this.pollInFlight = null
		/** Consecutive failed polls — drives the backoff. */
		this.consecutiveFailures = 0
		/** Set by #stopPolling so an already-scheduled tick doesn't fire. */
		this.pollStopped = false
		this.pollTimer = null
	}

	async init(config, _isFirstInit, secrets) {
		this.config = config ?? {}
		this.secrets = secrets ?? {}
		this.updateStatus(InstanceStatus.Connecting)
		this.#buildApi()

		this.setActionDefinitions(buildActions(this))
		this.setFeedbackDefinitions(buildFeedbacks(this))
		const { definitions, values } = buildVariables(this)
		this.setVariableDefinitions(definitions)
		this.setVariableValues(values)
		this.#publishPresets()

		// One immediate poll so the buttons are right within a second of
		// the connection being enabled, then the loop. Concurrent, not
		// sequential: each request carries an 8 s timeout, and init() should
		// not hold Companion for 16 s against an unreachable server.
		await Promise.all([this.#refreshLanguages(), this.poll()])
		this.#startPolling()
	}

	async destroy() {
		this.#stopPolling()
	}

	async configUpdated(config, secrets) {
		// Only replace what was actually supplied. Companion may call this
		// with secrets omitted (a label-only change), and blanking the token
		// there would drop a working booth into BadConfig mid-service.
		if (config !== undefined) this.config = config ?? {}
		if (secrets !== undefined) this.secrets = secrets ?? {}
		this.#buildApi()
		this.updateStatus(InstanceStatus.Connecting)
		this.consecutiveFailures = 0
		await Promise.all([this.#refreshLanguages(), this.poll()])
		this.#startPolling()
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'intro',
				width: 12,
				label: 'Where to find these',
				value:
					'Open your ChurchTranslator.AI dashboard → <b>Connected devices</b>. ' +
					'The <b>Booth control</b> card shows your control URL and mints a ' +
					'dedicated "Booth Stream Deck" token you can revoke on its own.',
			},
			{
				type: 'textinput',
				id: 'baseUrl',
				label: 'Server URL',
				width: 12,
				default: 'https://api.churchtranslator.ai',
				tooltip: 'The control base URL from the Booth control card. No trailing slash.',
			},
			{
				// A secret field, not a textinput: capture tokens drive audio
				// ingest and billing, so Companion should store it encrypted
				// and never show it back.
				type: 'secret-text',
				id: 'token',
				label: 'Capture token',
				width: 12,
				tooltip: 'Mint a dedicated "Booth Stream Deck" token so it can be revoked separately.',
			},
			{
				type: 'textinput',
				id: 'sessionId',
				label: 'Session name',
				width: 6,
				default: 'Sunday',
				tooltip: 'Leave as Sunday unless support tells you otherwise.',
			},
			{
				type: 'number',
				id: 'pollSeconds',
				label: 'Status refresh (seconds)',
				width: 6,
				default: DEFAULT_POLL_SECONDS,
				min: MIN_POLL_SECONDS,
				max: MAX_POLL_SECONDS,
			},
		]
	}

	#buildApi() {
		this.api = new ControlApi({
			baseUrl: this.config.baseUrl,
			// Companion 2.x keeps secrets out of config; older configs that
			// still carry a plain token keep working (see upgrades.js).
			token: this.secrets.token || this.config.token,
			sessionId: this.config.sessionId || 'Sunday',
		})
	}

	/**
	 * Self-rescheduling poll loop — deliberately NOT setInterval.
	 *
	 * setInterval fires on the clock regardless of whether the previous
	 * poll finished. Each poll makes requests with an 8 s timeout on a 3 s
	 * timer, so a church whose internet goes slow stacks concurrent polls
	 * and an older, slower response can land after a newer one and write
	 * stale state onto the buttons. Rescheduling only after a poll
	 * completes makes overlap structurally impossible.
	 *
	 * Failures back off (3 s → 6 → 12 → 24 → 48 → 60 cap) so a booth left
	 * running against a dead server doesn't hammer it all week, and
	 * recover immediately on the first success.
	 */
	#startPolling() {
		this.#stopPolling()
		this.pollStopped = false
		const base = Math.min(
			MAX_POLL_SECONDS,
			Math.max(MIN_POLL_SECONDS, Number(this.config.pollSeconds) || DEFAULT_POLL_SECONDS),
		)
		const tick = async () => {
			if (this.pollStopped) return
			await this.poll().catch(() => {
				/* poll() already recorded the failure in state */
			})
			if (this.pollStopped) return
			const backoff = this.consecutiveFailures
				? Math.min(base * 2 ** Math.min(this.consecutiveFailures, 5), MAX_BACKOFF_SECONDS)
				: base
			this.pollTimer = setTimeout(tick, backoff * 1000)
		}
		// Scheduled, not immediate: every caller of #startPolling has just
		// polled, and firing again here would double every connect and
		// config change.
		this.pollTimer = setTimeout(tick, base * 1000)
	}

	#stopPolling() {
		this.pollStopped = true
		if (this.pollTimer) {
			clearTimeout(this.pollTimer)
			this.pollTimer = null
		}
	}

	/**
	 * Refresh state from the API and push it to buttons.
	 *
	 * Two requests: /status for the live session, /source-language for the
	 * language and what the church's schedule would switch to. They stay
	 * separate because status is session-scoped and language is
	 * tenant-scoped; at a 3 s poll that is two small GETs a tick.
	 */
	async poll() {
		// Single-flight. poll() is called by the loop, by willAppear, and
		// after every action; without this, a button press during a slow
		// poll starts a second one and the two race to write state.
		if (this.pollInFlight) return this.pollInFlight
		this.pollInFlight = this.#doPoll().finally(() => {
			this.pollInFlight = null
		})
		return this.pollInFlight
	}

	async #doPoll() {
		if (!this.api?.configured) {
			this.updateStatus(InstanceStatus.BadConfig, 'Server URL and capture token required')
			this.state.reachable = false
			this.#publish()
			return
		}
		try {
			// /status is required; the speaker-language endpoint is not.
			// A server that predates speaker-language support still drives
			// start/pause/resume/stop perfectly well, and a red connection
			// on an otherwise working booth would be a lie.
			const status = await this.api.status()
			let language = {}
			// Don't re-ask a server that has already said 404 — that was a
			// wasted request every 3 s forever. Retry occasionally so the
			// buttons come back by themselves after the church's server is
			// upgraded, without anyone restarting Companion.
			const retryDue = Date.now() - (this.languageApiMissingAt || 0) > LANGUAGE_RETRY_MS
			if (!this.languageApiMissing || retryDue) {
				try {
					language = await this.api.sourceLanguage()
					if (this.languageApiMissing) {
						this.log('info', 'This server now supports the speaker-language buttons.')
					}
					this.languageApiMissing = false
				} catch (e) {
					if (e instanceof ApiError && e.notFound) {
						if (!this.languageApiMissing) {
							this.log(
								'warn',
								'This server does not support the speaker-language buttons yet ' +
									'(everything else works). Ask ChurchTranslator.AI to update it.',
							)
						}
						this.languageApiMissing = true
						this.languageApiMissingAt = Date.now()
					} else {
						// Any OTHER failure on the optional call — a 500, a
						// timeout — must not take a working booth red. Keep the
						// last known language and carry on; /status decides
						// whether the connection is healthy.
						this.log('debug', `speaker-language poll failed, keeping last known value: ${e.message}`)
						language = {
							sourceLanguage: this.state.sourceLanguage,
							scheduledSourceLanguage: this.state.scheduledSourceLanguage,
						}
					}
				}
			} else {
				language = { sourceLanguage: this.state.sourceLanguage }
			}
			this.state = {
				reachable: true,
				running: Boolean(status.running),
				paused: Boolean(status.paused),
				// Absent on a server that predates remote start; falsy is
				// the right reading there, since nothing can be pending.
				remoteStartPending: Boolean(status.remoteStartPending),
				listeners: Number(status.listeners) || 0,
				voiceMode: String(status.voiceMode || ''),
				sourceLanguage: String(language.sourceLanguage || status.sourceLanguage || ''),
				scheduledSourceLanguage: String(language.scheduledSourceLanguage || ''),
				perLangMinutes: status.perLangMinutes || {},
				lastError: '',
			}
			this.updateStatus(InstanceStatus.Ok)
			this.consecutiveFailures = 0
			// A connection enabled before the server was reachable published
			// the tiny offline fallback roster and never retried, leaving the
			// dropdowns permanently short. Recover on the first good poll.
			if (!this.languageChoices.length) {
				await this.#refreshLanguages()
			}
			// The presets include a button for the language currently being
			// preached, which may not be one of the church's translation
			// targets (a Russian-speaking church translating only INTO
			// English has no "ru" target). That language isn't known until
			// the first poll, and it changes when someone switches, so the
			// preset list is rebuilt whenever it moves.
			if (this.state.sourceLanguage !== this.presetsBuiltFor) {
				this.#publishPresets()
			}
		} catch (e) {
			this.state.reachable = false
			this.state.lastError = e.message
			this.consecutiveFailures = (this.consecutiveFailures || 0) + 1
			// A revoked token is the operator's problem to fix and says so;
			// anything else is the network and will probably fix itself.
			if (e instanceof ApiError && e.isAuth) {
				this.updateStatus(InstanceStatus.AuthenticationFailure, e.message)
			} else {
				this.updateStatus(InstanceStatus.ConnectionFailure, e.message)
			}
		}
		this.#publish()
	}

	/**
	 * Language roster for the action dropdown. Fetched from the API rather
	 * than baked in, so a module published months ago still offers every
	 * language the platform supports today.
	 */
	async #refreshLanguages() {
		if (!this.api?.configured) return
		try {
			const body = await this.api.languages()
			this.languageLabels = Object.fromEntries((body.sourceLanguages || []).map((l) => [l.code, l.label]))
			this.languageChoices = (body.sourceLanguages || []).map((l) => ({
				id: l.code,
				// Mark, don't hide: the server accepts the union, and a church
				// that switches engine next week shouldn't lose its button.
				label: l.engineSupported ? `${l.label} (${l.code})` : `${l.label} (${l.code}) — not in current engine`,
			}))
			// BOTH definition sets, not just actions: the "Speaker's
			// language is" FEEDBACK carries the same dropdown, and
			// rebuilding only actions left it stuck on the tiny offline
			// fallback list (caught the first time this ran inside real
			// Companion — the action offered 106 languages, the feedback
			// offered two).
			this.setActionDefinitions(buildActions(this))
			this.setFeedbackDefinitions(buildFeedbacks(this))
			this.targetLanguages = body.targetLanguages || []
			this.#publishPresets()
			this.log('info', `Loaded ${this.languageChoices.length} languages from the server`)
		} catch (e) {
			this.log('debug', `Could not load the language list: ${e.message}`)
		}
	}

	#publishPresets() {
		const { structure, presets } = buildPresets(this, this.targetLanguages)
		this.setPresetDefinitions(structure, presets)
		this.presetsBuiltFor = this.state.sourceLanguage
	}

	/** Push the current state to every feedback and variable. */
	#publish() {
		const { values } = buildVariables(this)
		this.setVariableValues(values)
		this.checkFeedbacks(
			'service_live',
			'service_starting',
			'service_paused',
			'has_listeners',
			'source_language_is',
			'schedule_pending',
		)
	}

	/** Human label for a code, falling back to the bare code. */
	labelFor(code) {
		if (!code) return ''
		return this.languageLabels[code] || code
	}

	/**
	 * Run an action, then poll so the buttons reflect the new state
	 * immediately instead of at the next tick. Errors are logged and
	 * surfaced on the connection rather than thrown into Companion.
	 */
	async runAction(description, fn) {
		try {
			const result = await fn()
			this.log('info', `${description} — ok`)
			await this.poll()
			return result
		} catch (e) {
			// Name the real cause when the server simply doesn't have the
			// endpoint — "404" on a booth deck tells an operator nothing.
			const reason =
				e instanceof ApiError && e.notFound && description.startsWith('Set speaker language')
					? 'this ChurchTranslator.AI server does not support speaker-language switching yet'
					: e.message
			this.log('error', `${description} failed: ${reason}`)
			this.state.lastError = reason
			if (e instanceof ApiError && e.isAuth) {
				this.updateStatus(InstanceStatus.AuthenticationFailure, e.message)
			}
			this.#publish()
			return undefined
		}
	}
}
