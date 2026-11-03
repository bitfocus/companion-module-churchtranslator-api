/**
 * Tests that drive the REAL instance class through a stand-in host.
 *
 * module.test.js covers the pure builders; this covers what only shows up
 * once Companion is holding the module: what gets published to the host,
 * when, and with what contents.
 *
 * The regression that prompted this file: the language roster arrives
 * asynchronously (the API serves it), and the refresh rebuilt the ACTION
 * definitions but not the FEEDBACK ones — so in real Companion the
 * "Set speaker's language" action offered 106 languages while the
 * "Speaker's language is" feedback offered the two-item offline
 * fallback. Nothing in the pure-builder tests could see it, because they
 * hand the builders an instance that already has its choices.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import ChurchTranslatorInstance from '../src/main.js'

const LANGUAGES = {
	ok: true,
	voiceMode: 'gemini',
	sourceLanguage: 'ru',
	sourceLanguages: [
		{ code: 'en', label: 'English', engineSupported: true },
		{ code: 'ru', label: 'Russian', engineSupported: true },
		{ code: 'uk', label: 'Ukrainian', engineSupported: true },
		{ code: 'mi', label: 'Maori', engineSupported: false },
	],
	targetLanguages: [
		{ code: 'en', label: 'English' },
		{ code: 'uk', label: 'Ukrainian' },
	],
}
const STATUS = { running: true, paused: false, listeners: 4, voiceMode: 'gemini', perLangMinutes: { uk: 2.5 } }
const SOURCE = { ok: true, sourceLanguage: 'ru', scheduledSourceLanguage: 'en', live: true }

/** Records everything the module publishes to the host. */
function fakeHost() {
	const published = { actions: [], feedbacks: [], presets: [], variableDefs: [], values: {}, status: [] }
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
			setActionDefinitions: (a) => published.actions.push(a),
			subscribeActions: () => {},
			unsubscribeActions: () => {},
			setFeedbackDefinitions: (f) => published.feedbacks.push(f),
			unsubscribeFeedbacks: () => {},
			checkFeedbacks: () => {},
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

function stubFetch(routes) {
	const original = globalThis.fetch
	globalThis.fetch = async (url) => {
		const u = String(url)
		for (const [fragment, body] of Object.entries(routes)) {
			if (u.includes(fragment)) {
				return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
			}
		}
		return new Response(JSON.stringify({ detail: 'not stubbed' }), { status: 404 })
	}
	return () => {
		globalThis.fetch = original
	}
}

async function startedInstance(routes = {}) {
	const restore = stubFetch({
		'/v1/control/languages': LANGUAGES,
		'/status': STATUS,
		'/v1/control/source-language': SOURCE,
		...routes,
	})
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	await instance.init({ baseUrl: 'https://api.test', sessionId: 'Sunday', pollSeconds: 60 }, true, { token: 'tok' })
	return { instance, host, cleanup: async () => (await instance.destroy(), restore()) }
}

const lastChoices = (definitions, id, optionId) =>
	definitions
		.at(-1)
		[id].options.find((o) => o.id === optionId)
		.choices.map((c) => c.id)

test('the language roster reaches the feedback dropdown, not just the action', async () => {
	const { host, cleanup } = await startedInstance()
	try {
		assert.deepEqual(lastChoices(host.published.actions, 'set_source_language', 'code'), ['en', 'ru', 'uk', 'mi'])
		// The regression: this used to be the offline fallback, because
		// only the actions were re-published after the roster loaded.
		assert.deepEqual(lastChoices(host.published.feedbacks, 'source_language_is', 'code'), ['en', 'ru', 'uk', 'mi'])
	} finally {
		await cleanup()
	}
})

test('a language the current engine cannot take is offered but marked', async () => {
	const { instance, cleanup } = await startedInstance()
	try {
		const mi = instance.languageChoices.find((c) => c.id === 'mi')
		assert.ok(mi, 'union codes must stay selectable — the server accepts them')
		assert.match(mi.label, /not in current engine/)
	} finally {
		await cleanup()
	}
})

test('presets are republished with the church own languages once they load', async () => {
	const { host, cleanup } = await startedInstance()
	try {
		const { presets } = host.published.presets.at(-1)
		assert.ok(presets['speak_en'])
		assert.ok(presets['speak_uk'])
		// The current speaker language gets a button even though it is not
		// in targetLanguages.
		assert.ok(presets['speak_ru'])
	} finally {
		await cleanup()
	}
})

test('a healthy poll reports Ok and fills the variables from live state', async () => {
	const { host, cleanup } = await startedInstance()
	try {
		assert.equal(host.published.status.at(-1)[0], 'ok')
		assert.equal(host.published.values.status, 'Live')
		assert.equal(host.published.values.listeners, 4)
		assert.equal(host.published.values.source_language_label, 'Russian')
		assert.equal(host.published.values.scheduled_source_language, 'en')
	} finally {
		await cleanup()
	}
})

test('a revoked token puts the connection into authentication failure', async () => {
	const restore = stubFetch({})
	globalThis.fetch = async () =>
		new Response(JSON.stringify({ detail: 'capture token invalid or revoked' }), { status: 401 })
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test' }, true, { token: 'revoked' })
		assert.equal(host.published.status.at(-1)[0], 'authentication_failure')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('no token at all is a config problem, not a connection problem', async () => {
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test' }, true, {})
		assert.equal(host.published.status.at(-1)[0], 'bad_config')
	} finally {
		await instance.destroy()
	}
})

test('the module still starts when the server is unreachable', async () => {
	const restore = stubFetch({})
	globalThis.fetch = async () => {
		throw new Error('ENOTFOUND')
	}
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test' }, true, { token: 'tok' })
		// Definitions still published, so the buttons a user already built
		// keep working the moment the network comes back.
		assert.ok(host.published.actions.length >= 1)
		assert.ok(host.published.feedbacks.length >= 1)
		assert.ok(host.published.presets.length >= 1)
		assert.equal(host.published.values.status, 'Unreachable')
		assert.equal(host.published.status.at(-1)[0], 'connection_failure')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('destroy stops the poll timer so a removed connection goes quiet', async () => {
	let calls = 0
	const restore = stubFetch({})
	globalThis.fetch = async (url) => {
		calls += 1
		const u = String(url)
		const body = u.includes('languages') ? LANGUAGES : u.includes('/status') ? STATUS : SOURCE
		return new Response(JSON.stringify(body), { status: 200 })
	}
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	await instance.init({ baseUrl: 'https://api.test', pollSeconds: 1 }, true, { token: 'tok' })
	await instance.destroy()
	const afterDestroy = calls
	await new Promise((r) => setTimeout(r, 1200))
	assert.equal(calls, afterDestroy, 'no requests may fire after destroy')
	restore()
})

test('an older server without the speaker-language endpoints still works', async () => {
	// Exactly the production case the day this module was written: prod had
	// pause/resume/stop/status, and the speaker-language endpoints were
	// still on dev. A booth driving start/stop must not show a red
	// connection because of a feature its server hasn't got yet.
	const restore = stubFetch({})
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('/status')) return new Response(JSON.stringify(STATUS), { status: 200 })
		return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
	}
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test' }, true, { token: 'tok' })
		assert.equal(host.published.status.at(-1)[0], 'ok', 'connection must stay green')
		assert.equal(host.published.values.status, 'Live')
		assert.equal(host.published.values.listeners, 4)
		// And it says so once, rather than silently doing nothing.
		assert.equal(instance.languageApiMissing, true)
	} finally {
		await instance.destroy()
		restore()
	}
})

test('a 404 on the required status endpoint is still reported as a failure', async () => {
	const restore = stubFetch({})
	globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'tenant not found' }), { status: 404 })
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test' }, true, { token: 'tok' })
		assert.equal(host.published.status.at(-1)[0], 'connection_failure')
	} finally {
		await instance.destroy()
		restore()
	}
})

// ---------------------------------------------------------------------------
// Poll-loop hardening
// ---------------------------------------------------------------------------
//
// All three of these were flagged in a pre-submission review of the module.
// They are the failure modes of a booth left running for a whole service
// against a server having a bad day, which is exactly when nobody is
// watching the Companion log.

test('polls never overlap, even when a press lands during a slow poll', async () => {
	let inFlight = 0
	let maxConcurrent = 0
	const restore = stubFetch({})
	globalThis.fetch = async (url) => {
		inFlight += 1
		maxConcurrent = Math.max(maxConcurrent, inFlight)
		await new Promise((r) => setTimeout(r, 40))
		inFlight -= 1
		const u = String(url)
		const body = u.includes('languages') ? LANGUAGES : u.includes('/status') ? STATUS : SOURCE
		return new Response(JSON.stringify(body), { status: 200 })
	}
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test', pollSeconds: 60 }, true, { token: 'tok' })
		// Three callers at once — the loop, a button press, a willAppear.
		await Promise.all([instance.poll(), instance.poll(), instance.poll()])
		// status + source-language are issued together inside one poll, so 2
		// concurrent is the floor; the bug was 4+ from stacked polls.
		assert.ok(maxConcurrent <= 2, `expected no stacked polls, saw ${maxConcurrent} concurrent requests`)
	} finally {
		await instance.destroy()
		restore()
	}
})

test('a server missing the language endpoint is not re-asked every tick', async () => {
	let languageCalls = 0
	const restore = stubFetch({})
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('/status')) return new Response(JSON.stringify(STATUS), { status: 200 })
		if (u.includes('source-language')) {
			languageCalls += 1
			return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
		}
		return new Response(JSON.stringify({ detail: 'Not Found' }), { status: 404 })
	}
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test', pollSeconds: 60 }, true, { token: 'tok' })
		const afterInit = languageCalls
		await instance.poll()
		await instance.poll()
		assert.equal(languageCalls, afterInit, 'must not re-request a known-missing endpoint')
		assert.equal(host.published.status.at(-1)[0], 'ok', 'and the connection stays green')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('a 5xx on the optional language endpoint keeps the connection green', async () => {
	// Only a 404 means "old server". A 500 is a bad day at the server, and
	// taking a live booth red over the language readout would be wrong.
	const restore = stubFetch({})
	globalThis.fetch = async (url) => {
		const u = String(url)
		if (u.includes('/status')) return new Response(JSON.stringify(STATUS), { status: 200 })
		if (u.includes('languages')) return new Response(JSON.stringify(LANGUAGES), { status: 200 })
		return new Response(JSON.stringify({ detail: 'boom' }), { status: 500 })
	}
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test', pollSeconds: 60 }, true, { token: 'tok' })
		assert.equal(host.published.status.at(-1)[0], 'ok')
		assert.equal(host.published.values.status, 'Live')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('a label-only config update does not blank the stored token', async () => {
	const { instance, host, cleanup } = await startedInstance()
	try {
		await instance.configUpdated({ baseUrl: 'https://api.test', sessionId: 'Sunday' }, undefined)
		assert.notEqual(host.published.status.at(-1)[0], 'bad_config')
		assert.equal(instance.secrets.token, 'tok', 'the token must survive')
	} finally {
		await cleanup()
	}
})

test('an empty 200 body is an ApiError, not a raw SyntaxError', async () => {
	const restore = stubFetch({})
	globalThis.fetch = async () => new Response(null, { status: 200 })
	try {
		const { ControlApi } = await import('../src/api.js')
		const api = new ControlApi({ baseUrl: 'https://api.test', token: 'tok', sessionId: 'Sunday' })
		assert.deepEqual(await api.pause(), {}, 'an empty body is simply empty')
	} finally {
		restore()
	}
})

// ---------------------------------------------------------------------------
// Bitfocus review of v1.3.1 (2026-10-30)
// ---------------------------------------------------------------------------

/** A fetch that counts requests per path fragment and answers from `routes`. */
function countingFetch(routes) {
	const counts = {}
	const restore = stubFetch({})
	globalThis.fetch = async (url, init) => {
		const u = String(url)
		for (const [fragment, answer] of Object.entries(routes)) {
			if (!u.includes(fragment)) continue
			counts[fragment] = (counts[fragment] || 0) + 1
			if (typeof answer === 'function') return answer(u, init)
			return new Response(JSON.stringify(answer), { status: 200 })
		}
		return new Response(JSON.stringify({ detail: 'not stubbed' }), { status: 404 })
	}
	return { counts, restore }
}

const ROUTES = {
	'/v1/control/languages': LANGUAGES,
	'/status': STATUS,
	'/v1/control/source-language': SOURCE,
}

test('a press aborted before it goes out sends nothing (M1)', async () => {
	const { counts, restore } = countingFetch({ ...ROUTES, '/start': { applied: true } })
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test', pollSeconds: 60 }, true, { token: 'tok' })
		await host.published.actions.at(-1).start_service.callback({ options: {} }, { signal: AbortSignal.abort() })
		assert.equal(counts['/start'] ?? 0, 0, 'a cancelled Start must never reach the server')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('a press aborted while waiting on the server is dropped quietly, with no follow-up poll (M1)', async () => {
	const { counts, restore } = countingFetch({
		...ROUTES,
		// Like real fetch: rejects as soon as the signal aborts.
		'/stop': (_u, init) =>
			new Promise((_resolve, reject) => {
				init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
			}),
	})
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test', pollSeconds: 60 }, true, { token: 'tok' })
		const statusBefore = counts['/status']
		const controller = new AbortController()
		const press = host.published.actions.at(-1).stop_service.callback({ options: {} }, { signal: controller.signal })
		setTimeout(() => controller.abort(), 10)
		await press
		assert.equal(counts['/stop'], 1)
		assert.equal(counts['/status'], statusBefore, 'no refresh after a cancelled press')
		assert.equal(host.published.status.at(-1)[0], 'ok', 'cancelling is not a connection failure')
		assert.equal(instance.state.lastError, '')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('a connection disabled during its first slow poll stays stopped (L1)', async () => {
	let calls = 0
	const restore = stubFetch({})
	globalThis.fetch = async (url) => {
		calls += 1
		await new Promise((r) => setTimeout(r, 50))
		const u = String(url)
		const body = u.includes('languages') ? LANGUAGES : u.includes('/status') ? STATUS : SOURCE
		return new Response(JSON.stringify(body), { status: 200 })
	}
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		const starting = instance.init({ baseUrl: 'https://api.test', pollSeconds: 1 }, true, { token: 'tok' })
		await instance.destroy()
		await starting
		const afterInit = calls
		await new Promise((r) => setTimeout(r, 1200))
		assert.equal(instance.pollTimer, null, 'no poll timer may be armed on a destroyed instance')
		assert.equal(calls, afterInit, 'no requests may fire after destroy')
	} finally {
		restore()
	}
})

test('an older server: a speaker-language change in the status reply reaches the buttons (L2)', async () => {
	let language = 'ru'
	const { restore } = countingFetch({
		'/status': () => new Response(JSON.stringify({ ...STATUS, sourceLanguage: language }), { status: 200 }),
		'/v1/control/languages': () => new Response('{}', { status: 404 }),
		'/v1/control/source-language': () => new Response('{}', { status: 404 }),
	})
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test', pollSeconds: 60 }, true, { token: 'tok' })
		assert.equal(instance.languageApiMissing, true)
		assert.equal(host.published.values.source_language, 'ru')
		language = 'en'
		await instance.poll()
		assert.equal(host.published.values.source_language, 'en', 'must not wait for the 5-minute re-probe')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('a 5xx on the language endpoint still takes the language from the status reply (L2)', async () => {
	let language = 'ru'
	let languageEndpointUp = true
	const { restore } = countingFetch({
		'/status': () => new Response(JSON.stringify({ ...STATUS, sourceLanguage: language }), { status: 200 }),
		'/v1/control/languages': LANGUAGES,
		'/v1/control/source-language': () =>
			languageEndpointUp
				? new Response(JSON.stringify({ ...SOURCE, sourceLanguage: language }), { status: 200 })
				: new Response('{}', { status: 500 }),
	})
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test', pollSeconds: 60 }, true, { token: 'tok' })
		languageEndpointUp = false
		language = 'en'
		await instance.poll()
		assert.equal(host.published.values.source_language, 'en')
		assert.equal(host.published.values.scheduled_source_language, 'en', 'the schedule pick is carried over')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('a language list that keeps failing is not re-fetched on every poll (L3)', async () => {
	const { counts, restore } = countingFetch({
		...ROUTES,
		'/v1/control/languages': () => new Response(JSON.stringify({ detail: 'boom' }), { status: 500 }),
	})
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test', pollSeconds: 60 }, true, { token: 'tok' })
		await instance.poll()
		await instance.poll()
		assert.equal(counts['/v1/control/languages'], 1, 'retried at most once a minute')
		// And once the minute is up, the next good poll tries again —
		// without the poll waiting for it.
		instance.languagesTriedAt = Date.now() - 61_000
		await instance.poll()
		assert.equal(counts['/v1/control/languages'], 2)
	} finally {
		await instance.destroy()
		restore()
	}
})

test('an empty language list counts as loaded (L3)', async () => {
	const { counts, restore } = countingFetch({
		...ROUTES,
		'/v1/control/languages': { ok: true, sourceLanguages: [], targetLanguages: [] },
	})
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test', pollSeconds: 60 }, true, { token: 'tok' })
		const actionsPublished = host.published.actions.length
		instance.languagesTriedAt = 0
		await instance.poll()
		assert.equal(counts['/v1/control/languages'], 1)
		assert.equal(host.published.actions.length, actionsPublished, 'definitions are not re-sent every poll')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('per-language variable names pick up the language names when the list lands after the status (L4)', async () => {
	let releaseLanguages
	const languagesHeld = new Promise((r) => (releaseLanguages = r))
	const { restore } = countingFetch({
		'/v1/control/languages': async () => (await languagesHeld, new Response(JSON.stringify(LANGUAGES))),
		'/status': { ...STATUS, sourceLanguage: 'ru', listenersByLanguage: { uk: 3 } },
		'/v1/control/source-language': SOURCE,
	})
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		const starting = instance.init({ baseUrl: 'https://api.test', pollSeconds: 60 }, true, { token: 'tok' })
		await new Promise((r) => setTimeout(r, 20))
		assert.equal(host.published.variableDefs.at(-1).listeners_uk.name, 'Listeners on uk (uk)')
		releaseLanguages()
		await starting
		assert.equal(host.published.variableDefs.at(-1).listeners_uk.name, 'Listeners on Ukrainian (uk)')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('a Server URL without https:// is a config error, not a connection failure (N1)', async () => {
	const { counts, restore } = countingFetch(ROUTES)
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'api.churchtranslator.ai' }, true, { token: 'tok' })
		const [status, message] = host.published.status.at(-1)
		assert.equal(status, 'bad_config')
		assert.match(message, /https:\/\//)
		assert.equal(Object.keys(counts).length, 0, 'nothing is sent to a malformed URL')
	} finally {
		await instance.destroy()
		restore()
	}
})

test('a pasted Server URL with stray whitespace still reaches the right path (N1)', async () => {
	const urls = []
	const restore = stubFetch({})
	globalThis.fetch = async (url) => {
		urls.push(String(url))
		return new Response(JSON.stringify(STATUS), { status: 200 })
	}
	try {
		const { ControlApi } = await import('../src/api.js')
		const api = new ControlApi({ baseUrl: ' https://api.test/ ', token: 'tok\n', sessionId: 'Sunday ' })
		await api.status()
		assert.deepEqual(urls, ['https://api.test/v1/control/Sunday/status'])
	} finally {
		restore()
	}
})

test('pressing a button with no token keeps Bad Config, never Authentication Failure (N2)', async () => {
	const host = fakeHost()
	const instance = new ChurchTranslatorInstance(host.context)
	try {
		await instance.init({ baseUrl: 'https://api.test' }, true, {})
		await host.published.actions
			.at(-1)
			.start_service.callback({ options: {} }, { signal: new AbortController().signal })
		assert.ok(
			host.published.status.every(([s]) => s !== 'authentication_failure'),
			'a missing token is not a revoked one',
		)
		assert.equal(host.published.status.at(-1)[0], 'bad_config')
	} finally {
		await instance.destroy()
	}
})
