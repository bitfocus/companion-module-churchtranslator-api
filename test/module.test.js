/**
 * Module tests — run with `npm test` (node --test).
 *
 * Companion itself isn't needed: the HTTP layer is tested against a fake
 * fetch, and actions/feedbacks/variables/presets are pure builders over
 * a fake instance. What's covered is the stuff that would embarrass us
 * in a live service:
 *
 *   * a revoked token must be reported as an auth failure, not as "the
 *     internet is down" — the operator has to know to re-mint it;
 *   * the pause button must resume when paused (one-button operation);
 *   * every preset referenced in the structure must exist, or the
 *     presets panel breaks;
 *   * variables must never render "undefined" onto a booth button.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ApiError, ControlApi } from '../src/api.js'
import { buildActions } from '../src/actions.js'
import { buildFeedbacks } from '../src/feedbacks.js'
import { buildVariables } from '../src/variables.js'
import { buildPresets } from '../src/presets.js'

/** Swap global fetch for one call, returning a recorded request log. */
function withFetch(handler, fn) {
	const original = globalThis.fetch
	const calls = []
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init })
		return handler(String(url), init)
	}
	return Promise.resolve(fn(calls)).finally(() => {
		globalThis.fetch = original
	})
}

const jsonResponse = (body, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const api = (over = {}) =>
	new ControlApi({
		baseUrl: 'https://api.example.test',
		token: 'tok',
		sessionId: 'Sunday',
		...over,
	})

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

test('status hits the session-scoped URL with a bearer token', async () => {
	await withFetch(
		() => jsonResponse({ running: true, paused: false, listeners: 3 }),
		async (calls) => {
			const body = await api().status()
			assert.equal(body.running, true)
			assert.equal(calls[0].url, 'https://api.example.test/v1/control/Sunday/status')
			assert.equal(calls[0].init.headers.Authorization, 'Bearer tok')
		},
	)
})

test('a trailing slash on the server URL does not produce a double slash', async () => {
	await withFetch(
		() => jsonResponse({}),
		async (calls) => {
			await api({ baseUrl: 'https://api.example.test/' }).status()
			assert.equal(calls[0].url, 'https://api.example.test/v1/control/Sunday/status')
		},
	)
})

test('a session name with spaces is encoded, not sent raw', async () => {
	await withFetch(
		() => jsonResponse({}),
		async (calls) => {
			await api({ sessionId: 'Sunday Night' }).status()
			assert.match(calls[0].url, /Sunday%20Night/)
		},
	)
})

test('setting the language lowercases it — a button labelled RU still works', async () => {
	await withFetch(
		() => jsonResponse({ ok: true, sourceLanguage: 'ru' }),
		async (calls) => {
			await api().setSourceLanguage('RU')
			assert.equal(calls[0].url, 'https://api.example.test/v1/control/source-language/ru')
			assert.equal(calls[0].init.method, 'POST')
		},
	)
})

test('a nonsense language code is rejected before a request goes out', async () => {
	await withFetch(
		() => {
			throw new Error('should not have been called')
		},
		async (calls) => {
			await assert.rejects(() => api().setSourceLanguage('Russian please'), ApiError)
			assert.equal(calls.length, 0)
		},
	)
})

test('401 is reported as an auth problem, so the operator re-mints the token', async () => {
	await withFetch(
		() => jsonResponse({ detail: 'capture token invalid or revoked' }, 401),
		async () => {
			await assert.rejects(
				() => api().status(),
				(e) => e instanceof ApiError && e.isAuth && e.status === 401,
			)
		},
	)
})

test('an API error message is surfaced, not swallowed behind the status code', async () => {
	await withFetch(
		() => jsonResponse({ detail: "Unsupported source language: 'xx'." }, 400),
		async () => {
			await assert.rejects(
				() => api().setSourceLanguage('xx'),
				(e) => e.message.includes('Unsupported source language'),
			)
		},
	)
})

test('an unreachable server is a connection failure, not an auth failure', async () => {
	await withFetch(
		() => {
			throw new Error('getaddrinfo ENOTFOUND')
		},
		async () => {
			await assert.rejects(
				() => api().status(),
				(e) => e instanceof ApiError && !e.isAuth,
			)
		},
	)
})

test('a missing token fails fast instead of sending an unauthenticated request', async () => {
	await withFetch(
		() => {
			throw new Error('should not have been called')
		},
		async (calls) => {
			await assert.rejects(() => api({ token: '' }).status(), ApiError)
			assert.equal(calls.length, 0)
		},
	)
})

// ---------------------------------------------------------------------------
// Actions / feedbacks / variables / presets
// ---------------------------------------------------------------------------

function fakeInstance(state = {}) {
	const calls = []
	const instance = {
		state: {
			reachable: true,
			running: false,
			paused: false,
			listeners: 0,
			voiceMode: 'gemini',
			sourceLanguage: 'en',
			scheduledSourceLanguage: '',
			perLangMinutes: {},
			lastError: '',
			...state,
		},
		languageLabels: { en: 'English', ru: 'Russian', uk: 'Ukrainian' },
		languageChoices: [
			{ id: 'en', label: 'English (en)' },
			{ id: 'ru', label: 'Russian (ru)' },
		],
		labelFor: (c) => instance.languageLabels[c] || c,
		log: (level, msg) => calls.push({ level, msg }),
		poll: async () => {},
		runAction: async (desc, fn) => {
			calls.push({ action: desc })
			return fn()
		},
		api: {
			pause: async () => ({ applied: true, action: 'pause' }),
			resume: async () => ({ applied: true, action: 'resume' }),
			stop: async () => ({ applied: true }),
			start: async () => ({ applied: true }),
			setSourceLanguage: async (code) => ({ ok: true, sourceLanguage: code, appliedToLiveSession: true }),
		},
		calls,
	}
	return instance
}

test('the toggle button pauses when live and resumes when paused', async () => {
	const live = fakeInstance({ running: true, paused: false })
	await buildActions(live).toggle_pause.callback({ options: {} })
	assert.match(live.calls.find((c) => c.action)?.action, /Pause/)

	const paused = fakeInstance({ running: true, paused: true })
	await buildActions(paused).toggle_pause.callback({ options: {} })
	assert.match(paused.calls.find((c) => c.action)?.action, /Resume/)
})

test('changing language during a live service warns that it applies to the next one', async () => {
	const instance = fakeInstance({ running: true })
	instance.api.setSourceLanguage = async (code) => ({
		ok: true,
		sourceLanguage: code,
		appliedToLiveSession: false,
	})
	await buildActions(instance).set_source_language.callback({ options: { code: 'ru' } })
	const warning = instance.calls.find((c) => c.level === 'warn')
	assert.ok(warning, 'expected a warning when a live session did not take the change')
	assert.match(warning.msg, /next service/)
})

test('the language dropdown offers something usable before the roster loads', () => {
	const instance = fakeInstance()
	instance.languageChoices = []
	const choices = buildActions(instance).set_source_language.options[0].choices
	assert.ok(choices.length > 0)
	assert.ok(choices.some((c) => c.id === 'en'))
})

test('live means streaming AND not paused', () => {
	const f = (state) => buildFeedbacks(fakeInstance(state))
	assert.equal(f({ running: true, paused: false }).service_live.callback({ options: {} }), true)
	assert.equal(f({ running: true, paused: true }).service_live.callback({ options: {} }), false)
	assert.equal(f({ running: false, paused: false }).service_live.callback({ options: {} }), false)
	assert.equal(f({ running: true, paused: true }).service_paused.callback({ options: {} }), true)
	// Paused with nothing streaming is not "paused" — it's off.
	assert.equal(f({ running: false, paused: true }).service_paused.callback({ options: {} }), false)
})

test('the language feedback lights the button whose code is active, case-insensitively', () => {
	const fb = buildFeedbacks(fakeInstance({ sourceLanguage: 'ru' })).source_language_is
	assert.equal(fb.callback({ options: { code: 'ru' } }), true)
	assert.equal(fb.callback({ options: { code: 'RU' } }), true)
	assert.equal(fb.callback({ options: { code: 'en' } }), false)
})

test('the schedule lamp lights only when the schedule disagrees with the current language', () => {
	const fb = (state) => buildFeedbacks(fakeInstance(state)).schedule_pending.callback({ options: {} })
	assert.equal(fb({ sourceLanguage: 'ru', scheduledSourceLanguage: 'en' }), true)
	assert.equal(fb({ sourceLanguage: 'en', scheduledSourceLanguage: 'en' }), false)
	assert.equal(fb({ sourceLanguage: 'en', scheduledSourceLanguage: '' }), false)
})

test('the status variable distinguishes offline from unreachable', () => {
	const status = (state) => buildVariables(fakeInstance(state)).values.status
	assert.equal(status({ reachable: true, running: true, paused: false }), 'Live')
	assert.equal(status({ reachable: true, running: true, paused: true }), 'Paused')
	assert.equal(status({ reachable: true, running: false }), 'Offline')
	assert.equal(status({ reachable: false, running: false }), 'Unreachable')
	// Between START and the capture app collecting it: Starting, not
	// Offline — the gap that makes an operator press START again.
	assert.equal(status({ reachable: true, running: false, remoteStartPending: true }), 'Starting')
	// A pending note never outranks a genuinely running service.
	assert.equal(status({ reachable: true, running: true, paused: false, remoteStartPending: true }), 'Live')
})

test('the starting feedback lights only in the press-to-streaming window', () => {
	const fb = (state) => buildFeedbacks(fakeInstance(state)).service_starting.callback({ options: {} })
	assert.equal(fb({ running: false, remoteStartPending: true }), true)
	assert.equal(fb({ running: true, remoteStartPending: true }), false)
	assert.equal(fb({ running: false, remoteStartPending: false }), false)
})

test('no variable ever renders as undefined on a button', () => {
	const { definitions, values } = buildVariables(fakeInstance())
	for (const id of Object.keys(definitions)) {
		assert.notEqual(values[id], undefined, `variable ${id} has no value`)
	}
	// And every value has a definition, or Companion lists a phantom.
	for (const id of Object.keys(values)) {
		assert.ok(definitions[id], `value ${id} has no definition`)
	}
})

test('the engine is named the way the dashboard names it', () => {
	assert.equal(buildVariables(fakeInstance({ voiceMode: 'gemini' })).values.engine, 'Natural Voice')
	assert.equal(buildVariables(fakeInstance({ voiceMode: 'dynamic' })).values.engine, 'Live Interpreter')
})

test('presets are generated from the church own languages, plus the current speaker language', () => {
	const instance = fakeInstance({ sourceLanguage: 'ru' })
	const { presets } = buildPresets(instance, [
		{ code: 'en', label: 'English' },
		{ code: 'uk', label: 'Ukrainian' },
	])
	assert.ok(presets['speak_ru'], 'the language being spoken needs a button even if it is not a target')
	assert.ok(presets['speak_en'])
	assert.ok(presets['speak_uk'])
	assert.ok(!presets['speak_es'], 'should not invent languages this church does not use')
})

test('every preset referenced by the structure exists', () => {
	const instance = fakeInstance({ sourceLanguage: 'ru' })
	const { structure, presets } = buildPresets(instance, [{ code: 'en', label: 'English' }])
	for (const section of structure) {
		for (const ref of section.definitions) {
			assert.ok(typeof ref === 'string', 'sections here use plain preset references')
			assert.ok(presets[ref], `structure references missing preset "${ref}"`)
		}
	}
})

test('every preset action and feedback refers to a real definition', () => {
	const instance = fakeInstance({ sourceLanguage: 'ru' })
	const { presets } = buildPresets(instance, [{ code: 'en', label: 'English' }])
	const actionIds = new Set(Object.keys(buildActions(instance)))
	const feedbackIds = new Set(Object.keys(buildFeedbacks(instance)))
	for (const [id, preset] of Object.entries(presets)) {
		for (const step of preset.steps) {
			for (const action of [...step.down, ...step.up]) {
				assert.ok(actionIds.has(action.actionId), `preset ${id} uses unknown action ${action.actionId}`)
			}
		}
		for (const fb of preset.feedbacks) {
			assert.ok(feedbackIds.has(fb.feedbackId), `preset ${id} uses unknown feedback ${fb.feedbackId}`)
		}
	}
})

test('presets survive a church with no languages configured yet', () => {
	const instance = fakeInstance({ sourceLanguage: '' })
	const { structure, presets } = buildPresets(instance, undefined)
	assert.ok(Object.keys(presets).length > 0)
	for (const section of structure) {
		for (const ref of section.definitions) assert.ok(presets[ref])
	}
})
