/**
 * The live input meter's feed.
 *
 * The status poll runs every few seconds — right for a lamp, useless for
 * a level meter. While a service is live and a meter button is placed,
 * one WebSocket to the server (/v1/control/{session}/meter) brings a
 * reading every 100 ms. If it can't connect (a flaky network, a proxy
 * that eats WebSockets), the meter falls back to the poll's coarse level
 * rather than vanishing (health.js inputView), and a server older than
 * the health read-out is never asked at all — main.js only wants the
 * socket once a poll has shown the health fields.
 *
 * This class owns the socket and the meter ballistics and nothing else:
 * WHEN the socket is wanted is main.js's call (syncMeter), and what a
 * reading looks like on a button is health.js's.
 */
import { METER_FLOOR_DB, METER_STALE_MS, PEAK_HOLD_MS, RELEASE_DB_PER_S } from './health.js'

/** Reconnect backoff ceiling, and the wait after a 4429 (the church already has its fill of meters open). */
const MAX_RETRY_MS = 60000
const TOO_MANY_RETRY_MS = 30000

export class MeterFeed {
	/**
	 * @param {object} opts
	 * @param {() => (WebSocket|null)} opts.connect  opens a socket; null when the runtime has no WebSocket
	 * @param {() => void} opts.onChange  a reading arrived, or the feed went quiet
	 * @param {(level: string, msg: string) => void} opts.log
	 */
	constructor({ connect, onChange, log }) {
		this.connect = connect
		this.onChange = onChange
		this.log = log
		this.socket = null
		/** Consecutive failed connections — drives the backoff; a reading resets it. */
		this.failures = 0
		this.retryAt = 0
		/** Logged once: this runtime cannot open a WebSocket at all. */
		this.unsupported = false
		this.#resetLevel()
	}

	#resetLevel() {
		/** Latest reading and when it arrived (ms). */
		this.reading = null
		this.at = 0
		/** Ballistics: the bar as drawn, and the peak-hold level. */
		this.shownDb = METER_FLOOR_DB
		this.holdDb = METER_FLOOR_DB
		this.holdAt = 0
		this.lastTick = 0
	}

	get isOpen() {
		return Boolean(this.socket)
	}

	/** The socket's reading if it is fresh, else null (the caller falls back to the poll). */
	fresh(now = Date.now()) {
		return this.at && now - this.at < METER_STALE_MS ? this.reading : null
	}

	/** Fast attack, steady release, a held peak — so speech reads as a bar, not a flicker. */
	apply(reading, now = Date.now()) {
		const dt = this.lastTick ? Math.min(1, (now - this.lastTick) / 1000) : 0
		this.lastTick = now
		const target =
			typeof reading.peakDb === 'number' && Number.isFinite(reading.peakDb) ? reading.peakDb : METER_FLOOR_DB
		this.shownDb = Math.max(target, this.shownDb - RELEASE_DB_PER_S * dt)
		if (target >= this.holdDb || now - this.holdAt > PEAK_HOLD_MS) {
			this.holdDb = target
			this.holdAt = now
		}
		this.reading = reading
		this.at = now
	}

	/**
	 * Open the socket if it is wanted and not already open (and not inside a
	 * backoff window); close it if it is not wanted. Cheap to call often —
	 * main.js calls it after every poll and once a second while live.
	 */
	want(wanted) {
		if (!wanted) {
			this.close()
			return
		}
		if (this.socket || this.unsupported || Date.now() < this.retryAt) return
		this.#open()
	}

	/** Close without counting it as a failure (paused, stopped, config changed). */
	close() {
		const sock = this.socket
		this.socket = null
		const hadLevel = Boolean(this.at)
		this.#resetLevel()
		if (sock) {
			sock.onclose = null
			sock.onmessage = null
			sock.onerror = null
			try {
				sock.close()
			} catch {
				/* already closing */
			}
		}
		if (hadLevel) this.onChange()
	}

	/** Forget the backoff — a new token or server deserves a prompt first try. */
	reset() {
		this.close()
		this.failures = 0
		this.retryAt = 0
	}

	#open() {
		let sock
		try {
			sock = this.connect()
		} catch (e) {
			this.failures += 1
			this.retryAt = Date.now() + MAX_RETRY_MS
			this.log('debug', `meter socket could not open: ${e.message}`)
			return
		}
		if (!sock) {
			// Node 22 has a global WebSocket; a host running something older
			// still gets a meter, just at the poll's pace.
			this.unsupported = true
			this.log('warn', 'No WebSocket in this runtime — the input meter will move at the status-refresh rate.')
			return
		}
		this.socket = sock
		sock.onmessage = (evt) => {
			if (this.socket !== sock) return
			let msg
			try {
				msg = JSON.parse(typeof evt.data === 'string' ? evt.data : String(evt.data))
			} catch {
				return
			}
			if (!msg || msg.type !== 'level') return
			this.failures = 0
			if (!msg.live) {
				// The stream ended under us; the next poll closes the socket.
				const hadLevel = Boolean(this.at)
				this.#resetLevel()
				if (hadLevel) this.onChange()
				return
			}
			this.apply(msg)
			this.onChange()
		}
		sock.onerror = () => {
			/* the close event that follows carries the code */
		}
		sock.onclose = (evt) => {
			if (this.socket !== sock) return
			this.socket = null
			this.failures += 1
			// 4429: this church already has eight meters open — wait a while
			// rather than queueing behind them. Anything else (a network
			// drop, 4401 for a revoked token — the poll reports that one)
			// backs off 2 s, 4 s, … to a minute.
			const code = evt?.code
			const wait = code === 4429 ? TOO_MANY_RETRY_MS : Math.min(MAX_RETRY_MS, 1000 * 2 ** Math.min(this.failures, 6))
			this.retryAt = Date.now() + wait
			this.log('debug', `meter socket closed (${code ?? 'no code'}); retrying in ${Math.round(wait / 1000)} s`)
			const hadLevel = Boolean(this.at)
			this.#resetLevel()
			if (hadLevel) this.onChange()
		}
	}
}
