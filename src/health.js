/**
 * The health read-out: how the service is DOING, not just whether it is on.
 *
 * Servers from 2026-10-02 add five fields to /status — listeners per
 * language, each language's translation state, the input level the
 * SERVER hears, and when the stream started — and a WebSocket that
 * pushes the level ten times a second (meter.js). This file is the pure
 * half: reading those fields, turning a level into meter segments, and
 * drawing the meter as pixels. No timers, no sockets, no Companion.
 *
 * The thresholds are the native Stream Deck plugin's (1.4.0), on purpose:
 * a church running both on two decks must see the same alarm at the same
 * moment, and booth volunteers who run the livestream already read OBS's
 * mixer colours, so the meter uses those zones rather than inventing its
 * own.
 *
 * Problems are shown by exception. A healthy deck looks the same every
 * Sunday, which is what makes the one amber key stand out.
 */

/** dBFS the server reports for silence. */
export const METER_FLOOR_DB = -90
/**
 * Ten LED segments, lit when the level reaches each step. The first step
 * is low on purpose: a live room's own noise (-60..-50) lights one
 * segment, so an open mic in a quiet moment never reads as dead.
 */
export const METER_STEPS = [-60, -46, -36, -28, -20, -16, -12, -9, -6, -3]
/**
 * Seconds of arriving-but-silent audio before NO SOUND. Long enough that a
 * gated microphone through a prayer doesn't cry wolf, short enough to beat
 * the server's own dead-feed email by minutes.
 */
export const NO_SOUND_AFTER_S = 15
/** Frames this stale on a live, unpaused stream mean the upload stopped. */
export const NO_FEED_AFTER_MS = 5000
/** A socket reading older than this is not live any more; use the poll's. */
export const METER_STALE_MS = 1500
/** Peak hold: the highest recent segment stays lit this long. */
export const PEAK_HOLD_MS = 2000
/** How fast the bar falls after a peak — near OBS's, a little quicker for 10 chunky LEDs. */
export const RELEASE_DB_PER_S = 20

const RED = [0xff, 0x4d, 0x4d]
const YELLOW = [0xf2, 0xc2, 0x30]
const GREEN = [0x3e, 0xc9, 0x7e]
const WHITE = [0xff, 0xff, 0xff]
/** Unlit segments stay faintly visible so the bar's length — the scale — reads in silence, like a hardware meter's dark LEDs. */
const UNLIT_ALPHA = 43

/** OBS's zones: green below -20, yellow to -9, red above. */
export const meterRgb = (db) => (db >= -9 ? RED : db >= -20 ? YELLOW : GREEN)

/** Lit segments for a level. */
export function segmentsFor(db) {
	let n = 0
	for (const step of METER_STEPS) if (db >= step) n += 1
	return n
}

/** 1:02:13 past the hour, 42:13 under it. */
export function formatElapsed(seconds) {
	const s = Math.max(0, Math.floor(seconds))
	const h = Math.floor(s / 3600)
	const m = Math.floor((s % 3600) / 60)
	const sec = String(s % 60).padStart(2, '0')
	return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** The on-air clock for a state, blank when nothing is live. */
export function onAirText(s, now = Date.now()) {
	return s.running && s.startedAt ? formatElapsed(now / 1000 - s.startedAt) : ''
}

/**
 * A language code as it appears in a variable id: `listeners_ru`. Codes
 * here are two or three letters, but a regional one (zh-TW) must not
 * produce an id Companion rejects, so anything else becomes `_`.
 */
export const varCode = (code) =>
	String(code || '')
		.toLowerCase()
		.replace(/[^a-z0-9_]/g, '_')

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * The health fields of a /status reply, normalised. `hasHealth` is the
 * feature switch: a server older than the read-out omits
 * `listenersByLanguage`, and everything health-related then stays exactly
 * as it was before this module learned about it.
 */
export function parseHealth(status) {
	const byLang = status?.listenersByLanguage
	const hasHealth = Boolean(byLang) && typeof byLang === 'object' && !Array.isArray(byLang)
	if (!hasHealth) {
		return {
			hasHealth: false,
			totalListeners: 0,
			listenersByLanguage: {},
			languageHealth: {},
			startedAt: null,
			input: null,
		}
	}
	const listenersByLanguage = {}
	for (const [code, n] of Object.entries(byLang)) listenersByLanguage[code] = Math.max(0, Number(n) || 0)
	const languageHealth = {}
	const health = status.languageHealth
	if (health && typeof health === 'object') {
		for (const [code, h] of Object.entries(health)) languageHealth[code] = String(h || '')
	}
	const input = status.input && typeof status.input === 'object' ? status.input : null
	return {
		hasHealth: true,
		// Cloud plus Local Wi-Fi listeners; `listeners` keeps its old,
		// cloud-only meaning for older decks.
		totalListeners: Number(status.totalListeners ?? status.listeners) || 0,
		listenersByLanguage,
		languageHealth,
		startedAt: Number(status.startedAt) || null,
		input,
	}
}

/**
 * What the input meter shows right now, from whichever source is
 * freshest: the live socket, else the poll's coarse level (which carries
 * the same silence and staleness clocks the alarms read).
 *
 * `mode` is off (not live) / paused / live / nosound / nofeed — or
 * unknown, when the stream is live but the server reports no level at all
 * (older than the read-out). While paused the capture app sends no audio,
 * so the level floors and the frame clock climbs: that is PAUSED, never
 * an alarm.
 *
 * @param {object} s       instance.state
 * @param {object} [meter] a MeterFeed, for its fresh reading + ballistics
 */
export function inputView(s, meter, now = Date.now()) {
	const view = { mode: 'off', lit: 0, hold: 0, peakDb: null }
	if (!s.reachable || !s.running) return view
	if (s.paused) return { ...view, mode: 'paused' }
	let reading = meter?.fresh(now) ?? null
	let shown = METER_FLOOR_DB
	let held = METER_FLOOR_DB
	if (reading) {
		if (reading.paused) return { ...view, mode: 'paused' }
		shown = meter.shownDb
		held = meter.holdDb
	} else if (s.input) {
		reading = s.input
		shown = held = finite(reading.peakDb) ? reading.peakDb : METER_FLOOR_DB
	}
	if (!reading) return { ...view, mode: 'unknown' }
	const peakDb = finite(reading.peakDb) ? reading.peakDb : null
	let mode = 'live'
	if (Number(reading.lastFrameAgoMs) > NO_FEED_AFTER_MS) mode = 'nofeed'
	else if (Number(reading.silentForS) >= NO_SOUND_AFTER_S) mode = 'nosound'
	if (mode !== 'live') return { ...view, mode, peakDb }
	return { mode, lit: segmentsFor(shown), hold: segmentsFor(held), peakDb }
}

/** What actually changes the drawn meter — compared before asking Companion to redraw. */
export const meterKey = (view) => `${view.mode}|${view.lit}|${view.hold}`

/**
 * The input meter as pixels: ten segments across the bottom of the
 * button, for an advanced feedback's `imageBuffer`.
 *
 * Pixel contract (checked against @companion-module/base 2.1.3's typings
 * and Companion 5.0's renderer, `drawPixelBuffer`): `imageBuffer` is a
 * base64 string of exactly width × height × 4 bytes for RGBA, drawn at
 * `imageBufferPosition` in the button's 72-unit space. Without an explicit
 * position Companion assumes a buffer the size of the whole canvas (whose
 * height depends on the top bar), so the position is always given. Gaps
 * are fully transparent, so the button's own colour — red in an alarm —
 * shows through.
 *
 * Nothing is drawn when the meter has nothing to say (`off`, `unknown`):
 * the button keeps its own face, as START does on the native plugin.
 *
 * @param {object} view   from inputView()
 * @param {{width:number,height:number}} [image] feedback.image, when Companion supplies it
 */
export function drawMeter(view, image) {
	if (view.mode === 'off' || view.mode === 'unknown') return {}
	const width = Math.max(20, Math.round(image?.width || 72))
	const canvasH = Math.max(20, Math.round(image?.height || 72))
	const n = METER_STEPS.length
	const gap = Math.max(1, Math.round(width / 36))
	const segW = Math.max(1, Math.floor((width - 2 * gap - (n - 1) * gap) / n))
	const pad = Math.floor((width - n * segW - (n - 1) * gap) / 2)
	const height = Math.max(4, Math.round(canvasH * 0.16))
	const bottom = Math.max(1, Math.round(canvasH * 0.04))
	// An alarm draws the scale in white over the alarm colour, unlit: the
	// words on the key say what is wrong, the empty bar says "no level".
	const mono = view.mode === 'nosound' || view.mode === 'nofeed'
	const px = new Uint8Array(width * height * 4)
	for (let i = 0; i < n; i++) {
		const on = !mono && (i < view.lit || i === view.hold - 1)
		const [r, g, b] = mono ? WHITE : meterRgb(METER_STEPS[i])
		const a = on ? 255 : UNLIT_ALPHA
		const x0 = pad + i * (segW + gap)
		for (let y = 0; y < height; y++) {
			for (let x = x0; x < x0 + segW; x++) {
				const o = (y * width + x) * 4
				px[o] = r
				px[o + 1] = g
				px[o + 2] = b
				px[o + 3] = a
			}
		}
	}
	return {
		imageBuffer: Buffer.from(px.buffer).toString('base64'),
		imageBufferEncoding: { pixelFormat: 'RGBA' },
		imageBufferPosition: { x: 0, y: canvasH - height - bottom, width, height },
	}
}
