/**
 * The health read-out (1.2.0): listeners per language, language trouble,
 * the on-air clock, and the live input meter.
 *
 * What would embarrass us in a live service, and so is pinned here:
 *
 *   * against an OLDER server nothing may change — no new variables, the
 *     old presets, and no meter socket (it would 404/close forever);
 *   * the meter socket is one of eight per church, so it is opened only
 *     while a service is live, unpaused, AND a meter button is placed;
 *   * NO SOUND / NO FEED fire on the plugin's thresholds and never while
 *     paused (a paused app sends no audio on purpose);
 *   * the meter element Companion draws lights what the bitmap meter
 *     lit, from nothing but the value feedback's { mode, lit, hold }.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import ChurchTranslatorInstance from '../src/main.js'
import { MeterFeed } from '../src/meter.js'
import {
	inputView,
	parseHealth,
	segmentsFor,
	formatElapsed,
	METER_GREEN,
	METER_RED,
	METER_STEPS,
	METER_YELLOW,
} from '../src/health.js'
import { buildCompositeElements } from '../src/composites.js'
import { buildPresets } from '../src/presets.js'

const LANGUAGES = {
	ok: true,
	voiceMode: 'gemini',
	sourceLanguage: 'en',
	sourceLanguages: [
		{ code: 'en', label: 'English', engineSupported: true },
		{ code: 'ru', label: 'Russian', engineSupported: true },
		{ code: 'uk', label: 'Ukrainian', engineSupported: true },
	],
	targetLanguages: [
		{ code: 'ru', label: 'Russian' },
		{ code: 'uk', label: 'Ukrainian' },
	],
}
const SOURCE = { ok: true, sourceLanguage: 'en', scheduledSourceLanguage: '', live: true }

/** A /status reply from a server WITH the read-out. */
const healthStatus = (over = {}) => ({
	running: true,
	paused: false,
	listeners: 40,
	voiceMode: 'gemini',
	perLangMinutes: { ru: 1, uk: 1 },
	totalListeners: 42,
	listenersByLanguage: { ru: 30, uk: 12 },
	languageHealth: { ru: 'translating', uk: 'stalled' },
	startedAt: Math.floor(Date.now() / 1000) - (42 * 60 + 13),
	input: { peakDb: -18.2, rmsDb: -30.1, lastFrameAgoMs: 40, silentForS: 0 },
	...over,
})
/** The same reply from a server OLDER than the read-out. */
const OLD_STATUS = { running: true, paused: false, listeners: 40, voiceMode: 'gemini', perLangMinutes: { ru: 1 } }

/** Stands in for Node's WebSocket; records every socket the module opens. */
class FakeSocket {
	static opened = []
	constructor(url, init) {
		this.url = url
		this.init = init
		this.closed = false
		FakeSocket.opened.push(this)
	}
	close() {
		this.closed = true
	}
	send() {}
	emit(msg) {
		this.onmessage?.({ data: JSON.stringify(msg) })
	}
	drop(code) {
		this.onclose?.({ code })
	}
}
const openSockets = () => FakeSocket.opened.filter((s) => !s.closed)

function fakeHost() {
	const published = { feedbacks: [], presets: [], variableDefs: [], values: {}, checks: [], status: [] }
	return {
		published,
		context: {
			_isInstanceContext: true,
			id: 'test',
			label: 'test',
			upgradeScripts: [],
			saveConfig: () => {},
			updateStatus: (s, m) => published.status.push([s, m ?? '']),
			oscSend: () => {},
			recordAction: () => {},
			setActionDefinitions: () => {},
			subscribeActions: () => {},
			unsubscribeActions: () => {},
			setFeedbackDefinitions: (f) => published.feedbacks.push(f),
			unsubscribeFeedbacks: () => {},
			checkFeedbacks: (types) => published.checks.push(types),
			checkAllFeedbacks: () => {},
			checkFeedbacksById: () => {},
			setPresetDefinitions: (structure, presets) => published.presets.push({ structure, presets }),
			setCompositeElementDefinitions: () => {},
			setVariableDefinitions: (v) => published.variableDefs.push(v),
			setVariableValues: (v) => Object.assign(published.values, v),
			getVariableValue: (id) => published.values[id],
			sharedUdpSocketHandlers: new Map(),
			sharedUdpSocketJoin: async () => '',
			sharedUdpSocketLeave: async () => {},
			sharedUdpSocketSend: async () => {},
		},
	}
}

/**
 * A started instance whose /status reply is whatever `server.status` is
 * at the time of each poll — tests flip it and call poll().
 */
async function startedInstance(status) {
	const server = { status }
	const originalFetch = globalThis.fetch
	const originalWebSocket = globalThis.WebSocket
	FakeSocket.opened = []
	globalThis.WebSocket = FakeSocket
	globalThis.fetch = async (url) => {
		const u = String(url)
		const body = u.includes('/v1/control/languages')
			? LANGUAGES
			: u.includes('/status')
				? server.status
				: u.includes('source-language')
					? SOURCE
					: null
		if (!body) return new Response(JSON.stringify({ detail: 'not stubbed' }), { status: 404 })
		return new Response(JSON.stringify(body), { status: 200 })
	}
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	await instance.init({ baseUrl: 'https://api.test', sessionId: 'Sunday', pollSeconds: 60 }, true, { token: 'tok' })
	return {
		instance,
		host,
		server,
		cleanup: async () => {
			await instance.destroy()
			globalThis.fetch = originalFetch
			globalThis.WebSocket = originalWebSocket
		},
	}
}

const feedbackDefs = (host) => host.published.feedbacks.at(-1)
const meterEvent = (id = 'meter-1') => ({
	id,
	type: 'value',
	feedbackId: 'input_level',
	controlId: 'bank:1-0-2',
	options: {},
	previousOptions: null,
})

/** Place a meter button, the way Companion does: by running its callback. */
async function placeMeter(host, id) {
	const result = feedbackDefs(host).input_level.callback(meterEvent(id), {})
	await Promise.resolve() // the module syncs the socket in a microtask
	return result
}

/**
 * One of the meter's expressions, evaluated as Companion would with these
 * variables. Companion's expression language is a subset of JavaScript,
 * so substituting each $(scope:id) with its value is all it takes.
 */
function evaluate(expression, vars) {
	const source = expression.replace(/\$\(([a-z]+):([a-z_]+)\)/g, (_, scope, id) => {
		const value = vars[`${scope}:${id}`]
		return value === undefined ? 'undefined' : JSON.stringify(value)
	})
	return new Function(`return (${source})`)()
}

/**
 * The meter element drawn for these option values: null when hidden, else
 * each segment, lit (fully opaque) or not, and its colour.
 */
function renderMeter(values) {
	const { options, elements } = buildCompositeElements().input_meter
	const vars = {}
	for (const field of options) {
		let value = values[field.id] ?? field.default
		// Companion reads a dropdown it can't match as its default.
		if (field.type === 'dropdown' && !field.choices.some((c) => c.id === value)) value = field.default
		vars[`options:${field.id}`] = value
	}
	const [scale] = elements
	if (!evaluate(scale.enabled.value, vars)) return null
	return scale.children.map((box) => ({
		on: evaluate(box.opacity.value, vars) === 100,
		color: evaluate(box.color.value, vars),
	}))
}

/** The Input meter preset's layered variant. */
const layeredMeter = (presets) => presets.input_meter.variants.find((v) => v.type === 'layered')

/** What the layered preset hands the meter element when the button's `level` variable holds this value. */
function boundOptions(presets, level) {
	const meter = layeredMeter(presets).elements.find((e) => e.type === 'composite')
	return Object.fromEntries(
		Object.entries(meter.options).map(([id, v]) => [id, evaluate(v.value, { 'local:level': level })]),
	)
}

// ---------------------------------------------------------------------------
// Parsing and the pure helpers
// ---------------------------------------------------------------------------

test('the health fields are parsed, and their absence is the feature switch', () => {
	const h = parseHealth(healthStatus())
	assert.equal(h.hasHealth, true)
	assert.equal(h.totalListeners, 42)
	assert.deepEqual(h.listenersByLanguage, { ru: 30, uk: 12 })
	assert.equal(h.languageHealth.uk, 'stalled')
	assert.equal(h.input.peakDb, -18.2)
	assert.ok(h.startedAt > 0)

	const old = parseHealth(OLD_STATUS)
	assert.equal(old.hasHealth, false)
	assert.deepEqual(old.listenersByLanguage, {})
	assert.equal(old.input, null)
})

test('segments light at the plugin thresholds', () => {
	assert.equal(segmentsFor(-90), 0)
	assert.equal(segmentsFor(-60), 1, 'room tone lights one segment')
	assert.equal(segmentsFor(-20), 5)
	assert.equal(segmentsFor(-9), 8)
	assert.equal(segmentsFor(0), 10)
	assert.equal(METER_STEPS.length, 10)
})

test('the on-air clock reads 42:13 under the hour and 1:02:13 past it', () => {
	assert.equal(formatElapsed(42 * 60 + 13), '42:13')
	assert.equal(formatElapsed(3600 + 2 * 60 + 13), '1:02:13')
	assert.equal(formatElapsed(-5), '0:00')
})

test('NO SOUND after 15 s of silence, NO FEED after 5 s without frames, never while paused', () => {
	const live = { reachable: true, running: true, paused: false }
	const view = (input, over = {}) => inputView({ ...live, ...over, input }).mode
	assert.equal(view({ peakDb: -20, lastFrameAgoMs: 40, silentForS: 0 }), 'live')
	assert.equal(
		view({ peakDb: -90, lastFrameAgoMs: 40, silentForS: 14 }),
		'live',
		'a long pause in prayer is not an alarm',
	)
	assert.equal(view({ peakDb: -90, lastFrameAgoMs: 40, silentForS: 15 }), 'nosound')
	assert.equal(view({ peakDb: -90, lastFrameAgoMs: 5001, silentForS: 30 }), 'nofeed', 'no frames outranks silence')
	assert.equal(view({ peakDb: -90, lastFrameAgoMs: 60000, silentForS: 60 }, { paused: true }), 'paused')
	assert.equal(view(null), 'unknown', 'live but no level at all: an older server')
	assert.equal(view({ peakDb: -20, lastFrameAgoMs: 40, silentForS: 0 }, { running: false }), 'off')
	assert.equal(view({ peakDb: -20, lastFrameAgoMs: 40, silentForS: 0 }, { reachable: false }), 'off')
})

test('the meter element lights up to the level plus the peak-hold segment, in OBS colours', () => {
	const segs = renderMeter({ mode: 'live', lit: 5, hold: 8 })
	assert.equal(segs.length, 10, 'ten segments drawn, lit or not')
	// Five lit plus the peak-hold segment at position 8.
	assert.deepEqual(
		segs.map((s) => s.on),
		[true, true, true, true, true, false, false, true, false, false],
	)
	assert.equal(segs[0].color, METER_GREEN, 'green below -20')
	assert.equal(segs[4].color, METER_YELLOW, 'yellow from -20')
	assert.equal(segs[7].color, METER_RED, 'red from -9')
	assert.equal(renderMeter({ mode: 'live', lit: 10, hold: 10 }).filter((s) => s.on).length, 10)
})

test('the ten segments fill the element edge to edge, in order, without touching', () => {
	const boxes = buildCompositeElements().input_meter.elements[0].children
	assert.equal(boxes.length, 10)
	assert.equal(boxes[0].x, 0)
	for (let i = 1; i < boxes.length; i++) {
		assert.ok(boxes[i].x > boxes[i - 1].x + boxes[i - 1].width, `a gap before segment ${i + 1}`)
		assert.equal(boxes[i].width, boxes[0].width)
	}
	const last = boxes.at(-1)
	assert.ok(Math.abs(last.x + last.width - 100) < 0.01, 'the last segment ends at the right edge')
	for (const box of boxes) assert.deepEqual([box.y, box.height], [0, 100])
})

test('paused and alarm meters draw the scale unlit; off and unknown draw nothing', () => {
	assert.equal(renderMeter({ mode: 'paused', lit: 0, hold: 0 }).filter((s) => s.on).length, 0)
	for (const mode of ['nosound', 'nofeed']) {
		// A stale level must not light anything over the alarm either.
		const alarm = renderMeter({ mode, lit: 6, hold: 9 })
		assert.equal(alarm.filter((s) => s.on).length, 0, mode)
		assert.ok(
			alarm.every((s) => s.color === 0xffffff),
			`${mode}: white over the alarm colour`,
		)
	}
	assert.equal(renderMeter({ mode: 'off', lit: 0, hold: 0 }), null)
	assert.equal(renderMeter({ mode: 'unknown', lit: 0, hold: 0 }), null)
})

test('the meter element reads only its own options', () => {
	// Companion rewrites every other $(prefix:…) in an element to the
	// connection's label, so anything else would read the wrong variable.
	const { options, elements } = buildCompositeElements().input_meter
	const ids = new Set(options.map((o) => o.id))
	const expressions = JSON.stringify(elements).match(/\$\([^)]*\)/g)
	assert.ok(expressions.length > 0)
	for (const ref of expressions) {
		const [, scope, id] = ref.match(/^\$\(([^:]+):([^)]+)\)$/)
		assert.equal(scope, 'options', ref)
		assert.ok(ids.has(id), `${ref} is not an option`)
	}
	for (const o of options) assert.ok(!o.disableAutoExpression, `${o.id} must accept the feedback's expression`)
})

test('meter ballistics: instant attack, 20 dB/s release, 2 s peak hold', () => {
	const feed = new MeterFeed({ connect: () => null, onChange: () => {}, log: () => {} })
	feed.apply({ peakDb: -10 }, 1000)
	assert.equal(feed.shownDb, -10)
	feed.apply({ peakDb: -60 }, 1500)
	assert.equal(feed.shownDb, -20, 'fell 10 dB in half a second')
	assert.equal(feed.holdDb, -10, 'peak still held')
	feed.apply({ peakDb: -60 }, 3600)
	assert.equal(feed.holdDb, -60, 'hold released after 2 s')
})

// ---------------------------------------------------------------------------
// The socket's own backoff
// ---------------------------------------------------------------------------

test('a failing meter socket backs off 2 s, 4 s … and 30 s on 4429; a reading resets it', () => {
	const socks = []
	const feed = new MeterFeed({
		connect: () => {
			const s = new FakeSocket('wss://x', {})
			socks.push(s)
			return s
		},
		onChange: () => {},
		log: () => {},
	})
	const waitAfter = (code) => {
		socks.at(-1).drop(code)
		return Math.round((feed.retryAt - Date.now()) / 1000)
	}
	feed.want(true)
	assert.equal(socks.length, 1)
	assert.equal(waitAfter(1006), 2)
	feed.want(true)
	assert.equal(socks.length, 1, 'no reconnect inside the backoff window')
	feed.retryAt = 0
	feed.want(true)
	assert.equal(waitAfter(1006), 4)
	feed.retryAt = 0
	feed.want(true)
	assert.equal(waitAfter(4429), 30, 'too many meters: wait, do not queue')
	feed.retryAt = 0
	feed.want(true)
	socks.at(-1).emit({ type: 'level', live: true, paused: false, peakDb: -20, lastFrameAgoMs: 10, silentForS: 0 })
	assert.equal(feed.failures, 0)
	assert.equal(waitAfter(1006), 2, 'back to the start of the ladder')
	feed.close()
})

// ---------------------------------------------------------------------------
// The instance, end to end against a fake host
// ---------------------------------------------------------------------------

test('a server with the read-out fills the health variables', async () => {
	const { host, cleanup } = await startedInstance(healthStatus())
	try {
		const defs = host.published.variableDefs.at(-1)
		for (const id of ['total_listeners', 'on_air', 'input_peak_db', 'input_state', 'listeners_ru', 'health_uk']) {
			assert.ok(defs[id], `variable ${id} is defined`)
		}
		// The speaker's language gets a variable too: its key shows a count.
		assert.ok(defs.listeners_en)
		const v = host.published.values
		assert.equal(v.total_listeners, 42)
		assert.equal(v.listeners_ru, 30)
		assert.equal(v.listeners_uk, 12)
		assert.equal(v.listeners_en, 0, 'zero, never blank')
		assert.equal(v.health_ru, 'translating')
		assert.equal(v.health_uk, 'stalled')
		assert.equal(v.health_en, '')
		assert.match(v.on_air, /^42:1[34]$/)
		assert.equal(v.input_peak_db, -18)
		assert.equal(v.input_state, 'live')
		// The old ones keep their meaning.
		assert.equal(v.listeners, 40)
		assert.equal(v.status, 'Live')
	} finally {
		await cleanup()
	}
})

test('an older server: no health variables, the old presets, and no meter socket', async () => {
	const { instance, host, cleanup } = await startedInstance(OLD_STATUS)
	try {
		await placeMeter(host, 'meter-1')
		await instance.poll()
		const defs = host.published.variableDefs.at(-1)
		for (const id of Object.keys(defs)) {
			assert.ok(!/^(total_listeners|on_air|input_|listeners_|health_)/.test(id), `${id} must not exist`)
		}
		for (const id of Object.keys(host.published.values)) {
			assert.ok(!/^(total_listeners|on_air|input_|listeners_|health_)/.test(id), `${id} must not be set`)
		}
		assert.equal(FakeSocket.opened.length, 0, 'never ask an old server for a meter')
		const value = feedbackDefs(host).input_level.callback(meterEvent('meter-1'), {})
		assert.deepEqual(value, { mode: 'unknown', lit: 0, hold: 0 })
		assert.equal(renderMeter(value), null, 'nothing drawn')
		const { presets, structure } = host.published.presets.at(-1)
		assert.equal(presets.speak_ru.style.text, 'Speak\\nRussian', 'language key exactly as before')
		assert.equal(presets.speak_ru.feedbacks.length, 1)
		assert.ok(!presets.input_meter)
		assert.ok(!structure[0].definitions.includes('input_meter'))
		assert.equal(instance.clockTimer, null, 'no clock without the read-out')
	} finally {
		await cleanup()
	}
})

test('the meter socket opens only while live AND a meter button is placed', async () => {
	const { instance, host, server, cleanup } = await startedInstance(healthStatus())
	try {
		assert.equal(FakeSocket.opened.length, 0, 'live, but nobody is looking at a meter')
		await placeMeter(host, 'meter-1')
		assert.equal(openSockets().length, 1)
		const sock = openSockets()[0]
		assert.equal(sock.url, 'wss://api.test/v1/control/Sunday/meter', 'wss for an https server')
		assert.equal(sock.init.headers.Authorization, 'Bearer tok')
		assert.ok(!sock.url.includes('tok'), 'the token rides in the header, not the URL')

		// A second meter button shares the socket.
		await placeMeter(host, 'meter-2')
		assert.equal(FakeSocket.opened.length, 1)

		// Paused: the app sends no audio, so the socket goes.
		server.status = healthStatus({ paused: true })
		await instance.poll()
		assert.equal(openSockets().length, 0, 'closed on pause')
		assert.equal(host.published.values.input_state, 'paused')

		server.status = healthStatus()
		await instance.poll()
		assert.equal(openSockets().length, 1, 'reopened on resume')

		// Stopped.
		server.status = healthStatus({ running: false, startedAt: null, input: null })
		await instance.poll()
		assert.equal(openSockets().length, 0, 'closed on stop')
		assert.equal(host.published.values.on_air, '', 'the clock goes blank')
		assert.equal(host.published.values.input_state, 'off')

		// Live again, then every meter button removed.
		server.status = healthStatus()
		await instance.poll()
		assert.equal(openSockets().length, 1)
		const defs = feedbackDefs(host)
		defs.input_level.unsubscribe(meterEvent('meter-1'), {})
		await Promise.resolve()
		assert.equal(openSockets().length, 1, 'one meter still placed')
		defs.input_level.unsubscribe(meterEvent('meter-2'), {})
		await Promise.resolve()
		assert.equal(openSockets().length, 0, 'closed when the last meter goes')
	} finally {
		await cleanup()
	}
	assert.equal(openSockets().length, 0, 'destroy leaves no socket behind')
})

test('socket readings drive the meter, alarms and variables', async () => {
	const { host, cleanup } = await startedInstance(healthStatus())
	try {
		await placeMeter(host, 'meter-1')
		const sock = openSockets()[0]
		sock.emit({ type: 'level', live: true, paused: false, peakDb: -7.6, rmsDb: -20, lastFrameAgoMs: 20, silentForS: 0 })
		assert.equal(host.published.values.input_peak_db, -8)
		const value = feedbackDefs(host).input_level.callback(meterEvent('meter-1'), {})
		assert.deepEqual(value, { mode: 'live', lit: 8, hold: 8 })
		assert.equal(renderMeter(value).filter((s) => s.on).length, 8, '-7.6 dBFS lights eight segments')

		// Twenty seconds of nothing: NO SOUND, at once — not at the next poll.
		host.published.checks.length = 0
		sock.emit({ type: 'level', live: true, paused: false, peakDb: -90, rmsDb: -90, lastFrameAgoMs: 20, silentForS: 20 })
		assert.equal(host.published.values.input_state, 'nosound')
		assert.ok(
			host.published.checks.some((c) => c.includes('input_alarm')),
			'alarm rechecked immediately',
		)
		const alarm = feedbackDefs(host).input_alarm
		assert.equal(alarm.callback({ options: { which: 'nosound' } }), true)
		assert.equal(alarm.callback({ options: { which: 'any' } }), true)
		assert.equal(alarm.callback({ options: { which: 'nofeed' } }), false)

		sock.emit({
			type: 'level',
			live: true,
			paused: false,
			peakDb: -90,
			rmsDb: -90,
			lastFrameAgoMs: 8000,
			silentForS: 20,
		})
		assert.equal(host.published.values.input_state, 'nofeed')
		assert.equal(alarm.callback({ options: { which: 'nofeed' } }), true)
	} finally {
		await cleanup()
	}
})

test('the poll alone raises NO SOUND when no socket is open', async () => {
	const { host, cleanup } = await startedInstance(
		healthStatus({ input: { peakDb: -90, rmsDb: -90, lastFrameAgoMs: 30, silentForS: 40 } }),
	)
	try {
		assert.equal(FakeSocket.opened.length, 0)
		assert.equal(host.published.values.input_state, 'nosound')
		assert.equal(feedbackDefs(host).input_alarm.callback({ options: { which: 'any' } }), true)
	} finally {
		await cleanup()
	}
})

test('meter redraws are throttled to 10/s and skipped when no segment changed', async () => {
	const { host, cleanup } = await startedInstance(healthStatus())
	try {
		await placeMeter(host, 'meter-1')
		const sock = openSockets()[0]
		const meterChecks = () => host.published.checks.filter((c) => c.length === 1 && c[0] === 'input_level').length
		const level = (peakDb) =>
			sock.emit({
				type: 'level',
				live: true,
				paused: false,
				peakDb,
				rmsDb: peakDb - 12,
				lastFrameAgoMs: 20,
				silentForS: 0,
			})

		await new Promise((r) => setTimeout(r, 120))
		host.published.checks.length = 0
		level(-5) // a change: drawn at once (the budget has elapsed)
		assert.equal(meterChecks(), 1)
		for (let i = 0; i < 20; i++) level(-5) // nothing new to draw
		assert.equal(meterChecks(), 1, 'identical segments are never redrawn')

		await new Promise((r) => setTimeout(r, 120))
		level(-2) // a change...
		level(-1) // ...and another straight after: same segments, nothing queued
		assert.equal(meterChecks(), 2)
		level(-0.5)
		level(-60) // the bar holds (release is 20 dB/s), so still unchanged
		assert.equal(meterChecks(), 2)

		// Two genuine changes inside one 100 ms window: the first is drawn at
		// once, the second by one trailing redraw — never both at once.
		await new Promise((r) => setTimeout(r, 120))
		host.published.checks.length = 0
		sock.emit({ type: 'level', live: true, paused: false, peakDb: -90, lastFrameAgoMs: 20, silentForS: 16 })
		assert.equal(meterChecks(), 1, 'NO SOUND drawn at once')
		sock.emit({ type: 'level', live: true, paused: false, peakDb: -90, lastFrameAgoMs: 8000, silentForS: 16 })
		assert.equal(meterChecks(), 1, 'NO FEED waits for the budget')
		await new Promise((r) => setTimeout(r, 150))
		assert.equal(meterChecks(), 2, 'and is drawn by the trailing redraw')
	} finally {
		await cleanup()
	}
})

test('language trouble lights amber for stalled and red for unavailable', async () => {
	const { instance, host, server, cleanup } = await startedInstance(healthStatus())
	try {
		const fb = feedbackDefs(host).language_trouble
		const on = (code, when) => fb.callback({ options: { code, when } })
		assert.equal(on('uk', 'stalled'), true)
		assert.equal(on('uk', 'unavailable'), false)
		assert.equal(on('ru', 'stalled'), false)
		assert.equal(on('UK', 'either'), true, 'case-insensitive, like the language lamp')

		server.status = healthStatus({ languageHealth: { ru: 'unavailable', uk: 'translating' } })
		await instance.poll()
		assert.equal(on('ru', 'unavailable'), true)
		assert.equal(on('uk', 'stalled'), false)
		assert.equal(host.published.values.health_ru, 'unavailable')
	} finally {
		await cleanup()
	}
})

test('with the read-out, language keys show their audience and the meter key appears beside START', async () => {
	const { host, cleanup } = await startedInstance(healthStatus())
	try {
		const { presets, structure } = host.published.presets.at(-1)
		assert.equal(presets.speak_ru.style.text, 'Russian\\n$(ct:listeners_ru)')
		const trouble = presets.speak_ru.feedbacks.filter((f) => f.feedbackId === 'language_trouble')
		assert.deepEqual(
			trouble.map((f) => f.options.when),
			['stalled', 'unavailable'],
		)
		assert.equal(presets.speak_ru.feedbacks.at(-1).feedbackId, 'language_trouble', 'trouble outranks the green lamp')
		const service = structure.find((s) => s.id === 'service').definitions
		assert.equal(service[service.indexOf('start_service') + 1], 'input_meter')
		const meter = layeredMeter(presets)
		assert.deepEqual(meter.localVariables, [
			{ variableType: 'feedback', variableName: 'level', feedbackId: 'input_level', options: {} },
		])
		assert.equal(meter.elements.at(-1).elementId, 'input_meter', 'the bar is drawn over the label')
		assert.equal(meter.feedbacks.at(-1).feedbackId, 'input_alarm', 'alarms come last and win')
		const elementIds = new Set(meter.elements.map((e) => e.id))
		for (const f of meter.feedbacks) {
			assert.ok(f.styleOverrides.length > 0, `${f.feedbackId} changes something`)
			for (const o of f.styleOverrides) {
				assert.ok(elementIds.has(o.elementId), `${f.feedbackId} overrides ${o.elementId}`)
				// Companion 5.0.3 drops a bare value — and the feedback with it.
				assert.equal(o.override?.isExpression, false, `${f.feedbackId}: ${o.elementProperty} is wrapped`)
			}
		}
		assert.ok(meter.feedbacks[0].styleOverrides.some((o) => o.override.value === '$(ct:on_air)'))
		// The simple fallback is the same key without the bar.
		const simple = presets.input_meter.variants.find((v) => v.type === 'simple')
		assert.deepEqual(
			simple.feedbacks.map((f) => f.feedbackId),
			meter.feedbacks.map((f) => f.feedbackId),
		)
		// Every variable a preset names must exist.
		const defs = host.published.variableDefs.at(-1)
		const variants = Object.values(presets).flatMap((p) => (p.type === 'alternatives' ? p.variants : [p]))
		for (const p of variants) {
			const texts = JSON.stringify([p.style, p.elements, p.feedbacks])
			for (const [, id] of texts.matchAll(/\$\(ct:([^)]+)\)/g))
				assert.ok(defs[id], `preset names undefined $(ct:${id})`)
		}
	} finally {
		await cleanup()
	}
})

test('the meter preset feeds the element the Input level value, and stays dark until it has one', async () => {
	const { instance, host, cleanup } = await startedInstance(healthStatus())
	try {
		const { presets } = host.published.presets.at(-1)
		assert.equal(renderMeter(boundOptions(presets, undefined)), null, 'no value yet: no bar')
		assert.deepEqual(boundOptions(presets, { mode: 'live', lit: 3, hold: 6 }), { mode: 'live', lit: 3, hold: 6 })
		// End to end: the value the feedback reports right now, through the
		// preset's bindings, into the element. The poll heard -18.2 dBFS.
		const value = feedbackDefs(host).input_level.callback(meterEvent('meter-1'), {})
		const segs = renderMeter(boundOptions(presets, value))
		assert.equal(segs.filter((s) => s.on).length, segmentsFor(-18.2))
		assert.equal(instance.meterFeedbackIds.size, 1, 'and the feedback counts as a placed meter')
	} finally {
		await cleanup()
	}
})

test('every health preset feedback refers to a real definition', () => {
	const instance = {
		state: { sourceLanguage: 'en', hasHealth: true },
		labelFor: (c) => ({ en: 'English', ru: 'Russian' })[c] || c,
	}
	const { presets } = buildPresets(instance, [{ code: 'ru', label: 'Russian' }])
	const ids = new Set(['service_live', 'service_starting', 'service_paused', 'has_listeners'])
	for (const id of ['source_language_is', 'schedule_pending', 'language_trouble', 'input_alarm', 'input_level'])
		ids.add(id)
	const variants = Object.values(presets).flatMap((p) => (p.type === 'alternatives' ? p.variants : [p]))
	for (const p of variants)
		for (const f of [...p.feedbacks, ...(p.localVariables || [])]) assert.ok(ids.has(f.feedbackId), f.feedbackId)
})
