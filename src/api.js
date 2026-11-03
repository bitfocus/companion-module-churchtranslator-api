/**
 * The ChurchTranslator.AI booth-control API, and the only file in this
 * module that knows its shape.
 *
 * Every call is a capture-token-authed HTTP request against
 * /v1/control/... . The token names exactly one church server-side, so
 * this module can never address another tenant's service no matter what
 * is typed into the config — the session id in the URL is namespaced to
 * the token's tenant by the API.
 *
 * Endpoints used:
 *   POST /v1/control/{session}/pause|resume|stop|start
 *   GET  /v1/control/{session}/status            — polled for feedback
 *   POST /v1/control/source-language/{code}
 *   GET  /v1/control/source-language
 *   GET  /v1/control/languages                   — dropdown contents
 *   WS   /v1/control/{session}/meter             — live input level (meter.js)
 *
 * Errors are normalised into ApiError so main.js can map them onto
 * Companion's connection status: a missing or malformed config is the
 * operator's to fix, 401 is a bad token (also the operator's), anything
 * else is a transient failure worth retrying.
 *
 * Every call takes an optional `signal`: an action passes Companion's
 * context.signal, so a press the operator aborts never reaches the server
 * (or stops waiting for it).
 */

export class ApiError extends Error {
	constructor(message, { status = 0, isAuth = false, isConfig = false, notFound = false, aborted = false } = {}) {
		super(message)
		this.name = 'ApiError'
		this.status = status
		/** The operator must fix something (bad or revoked token). */
		this.isAuth = isAuth
		/** The config can't be used as typed (blank, or not a URL) — nothing was sent. */
		this.isConfig = isConfig
		/** The caller's signal aborted: the operator cancelled the press. */
		this.aborted = aborted
		/**
		 * The server answered 404. On the OPTIONAL endpoints that means
		 * "this server is older than this module" — speaker-language
		 * support shipped after pause/resume/stop did, and a church can be
		 * pointed at a server that predates it. The module degrades to what
		 * the server does have rather than going red.
		 */
		this.notFound = notFound
	}
}

export class ControlApi {
	/**
	 * @param {object} opts
	 * @param {string} opts.baseUrl   e.g. https://api.churchtranslator.ai
	 * @param {string} opts.token     capture token (a "Booth Stream Deck" one)
	 * @param {string} opts.sessionId usually "Sunday"
	 * @param {number} opts.timeoutMs per-request timeout
	 */
	constructor({ baseUrl, token, sessionId, timeoutMs = 8000 }) {
		// Trimmed: a pasted URL with a trailing space sent every request
		// to /%20/v1/control/..., and the 404 read "the church may no
		// longer exist" — the wrong lead entirely.
		this.baseUrl = String(baseUrl || '')
			.trim()
			.replace(/\/+$/, '')
		this.token = String(token || '').trim()
		this.sessionId = String(sessionId || '').trim() || 'Sunday'
		this.timeoutMs = timeoutMs
	}

	/** Why this config can't be used, or '' when it can. */
	get configProblem() {
		if (!this.baseUrl || !this.token) return 'Server URL and capture token required'
		// Without a scheme, fetch fails with "Failed to parse URL" and the
		// connection showed as unreachable rather than mistyped.
		if (!/^https?:\/\/\S+$/i.test(this.baseUrl)) {
			return 'Server URL must start with https:// (e.g. https://api.churchtranslator.ai)'
		}
		return ''
	}

	get configured() {
		return !this.configProblem
	}

	/** A failed fetch or body read, as an ApiError: cancelled, or the network. */
	#failure(e, signal) {
		if (signal?.aborted) return new ApiError('Cancelled', { aborted: true })
		return new ApiError(`Cannot reach ${this.baseUrl}: ${e.message}`, { status: 0 })
	}

	async #request(method, path, { signal } = {}) {
		if (!this.configured) {
			throw new ApiError(this.configProblem, { isConfig: true })
		}
		// AbortSignal.timeout keeps a wedged request from stalling the
		// poll loop forever — a booth on hotel Wi-Fi hits this.
		const timeout = AbortSignal.timeout(this.timeoutMs)
		const res = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${this.token}`,
				Accept: 'application/json',
			},
			signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
		}).catch((e) => {
			throw this.#failure(e, signal)
		})

		if (res.status === 401) {
			throw new ApiError('Capture token rejected — it may have been revoked', {
				status: 401,
				isAuth: true,
			})
		}
		if (res.status === 404) {
			// Two different things arrive as 404: a token whose church no
			// longer exists, and an endpoint this server doesn't have yet.
			// Not an auth failure either way — the caller decides, because
			// only it knows whether the endpoint was optional.
			throw new ApiError('Not found — the church may no longer exist, or this server is out of date', {
				status: 404,
				notFound: true,
			})
		}
		if (!res.ok) {
			// The API returns {detail} for HTTPException and {reason} for
			// the JSONResponse paths; surface whichever is there.
			let detail = `HTTP ${res.status}`
			try {
				const body = await res.json()
				detail = body?.detail || body?.reason || detail
			} catch {
				/* non-JSON error body — the status is all we have */
			}
			throw new ApiError(detail, { status: res.status })
		}
		// Not res.json(): a 200 with an empty or non-JSON body (a proxy
		// returning 204, an HTML error page from a captive portal) threw a
		// raw SyntaxError straight past every ApiError handler, so the
		// connection reported "Unexpected end of JSON input" instead of
		// something an operator could act on.
		const text = await res.text().catch((e) => {
			throw this.#failure(e, signal)
		})
		if (!text) return {}
		try {
			return JSON.parse(text)
		} catch {
			throw new ApiError('Server returned a non-JSON response — is the Server URL correct?', {
				status: res.status,
			})
		}
	}

	/** Live status for button feedback: running/paused/listeners/engine/language. */
	status() {
		return this.#request('GET', `/v1/control/${encodeURIComponent(this.sessionId)}/status`)
	}

	/**
	 * Arms the session AND asks an idle capture app to start streaming
	 * (the server leaves a note the app collects on its own poll). The
	 * response's `remoteStartRequested` says a note was left, not that
	 * audio is flowing — watch `running` on the status poll for that.
	 */
	start(opts) {
		return this.#request('POST', `/v1/control/${encodeURIComponent(this.sessionId)}/start`, opts)
	}

	pause(opts) {
		return this.#request('POST', `/v1/control/${encodeURIComponent(this.sessionId)}/pause`, opts)
	}

	resume(opts) {
		return this.#request('POST', `/v1/control/${encodeURIComponent(this.sessionId)}/resume`, opts)
	}

	stop(opts) {
		return this.#request('POST', `/v1/control/${encodeURIComponent(this.sessionId)}/stop`, opts)
	}

	/** Current speaker language + what the church's schedule would pick now. */
	sourceLanguage() {
		return this.#request('GET', '/v1/control/source-language')
	}

	/**
	 * Set the speaker's language. Takes effect for the NEXT session when a
	 * service is already streaming — the response's appliedToLiveSession
	 * says which happened, and the module reports that to the operator —
	 * unless `applyNow`: then the server restarts the running service's
	 * translation on the new language (?apply=now; listeners hear a few
	 * seconds' pause).
	 */
	// async, so a bad code REJECTS like every other failure here rather
	// than throwing synchronously — a caller doing .catch() on this must
	// not miss the one error that arrives by a different door.
	async setSourceLanguage(code, { applyNow = false, signal } = {}) {
		const clean = String(code || '')
			.trim()
			.toLowerCase()
		if (!/^[a-z]{2,3}$/.test(clean)) {
			throw new ApiError(`"${code}" is not a language code (expected e.g. ru, en, uk)`, { status: 400 })
		}
		return this.#request('POST', `/v1/control/source-language/${clean}${applyNow ? '?apply=now' : ''}`, { signal })
	}

	/** Roster for the "Set speaker language" dropdown, served by the API. */
	languages() {
		return this.#request('GET', '/v1/control/languages')
	}

	/**
	 * The live input-level socket (servers from 2026-10-02). The server
	 * also takes the token as `?t=`, for clients that cannot set headers
	 * on a WebSocket; Node's can, so the token stays out of the URL — and
	 * out of every proxy and access log that records one.
	 *
	 * Returns null when this runtime has no WebSocket (Node < 22).
	 */
	openMeterSocket() {
		if (!this.configured) {
			throw new ApiError(this.configProblem, { isConfig: true })
		}
		const WS = globalThis.WebSocket
		if (typeof WS !== 'function') return null
		const url = `${this.baseUrl.replace(/^http/i, 'ws')}/v1/control/${encodeURIComponent(this.sessionId)}/meter`
		return new WS(url, { headers: { Authorization: `Bearer ${this.token}` } })
	}
}
