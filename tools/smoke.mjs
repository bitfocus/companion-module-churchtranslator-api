/**
 * Drive the real module against a real server, without Companion.
 *
 * Companion is the only thing that normally constructs an InstanceBase,
 * so this file stands in for it: a fake host context (the shape
 * isInstanceContext expects), then init() and a few real actions. It is
 * how the module was verified end to end — the unit tests use a fake
 * fetch, and this proves the other half: that the live API answers the
 * way the module assumes.
 *
 *   node tools/smoke.mjs <capture-token> [baseUrl]
 *
 * Point it at DEV. It changes the church's speaker language for real
 * (and puts it back), which is not something to do to a live service.
 */
import ChurchTranslatorInstance from '../src/main.js'

const token = process.argv[2]
const baseUrl = process.argv[3] ?? 'https://api.dev.churchtranslator.ai'
const captured = { status: [], actions: null, feedbacks: null, variables: null, presets: null, values: {}, logs: [] }
const context = {
	_isInstanceContext: true,
	id: 'smoke',
	label: 'ChurchTranslator smoke',
	upgradeScripts: [],
	saveConfig: () => {},
	updateStatus: (s, m) => captured.status.push([s, m ?? '']),
	oscSend: () => {},
	recordAction: () => {},
	setActionDefinitions: (a) => (captured.actions = a),
	subscribeActions: () => {},
	unsubscribeActions: () => {},
	setFeedbackDefinitions: (f) => (captured.feedbacks = f),
	unsubscribeFeedbacks: () => {},
	checkFeedbacks: () => {},
	checkAllFeedbacks: () => {},
	checkFeedbacksById: () => {},
	setPresetDefinitions: (structure, presets) => (captured.presets = { structure, presets }),
	setCompositeElementDefinitions: () => {},
	setVariableDefinitions: (v) => (captured.variables = v),
	setVariableValues: (v) => Object.assign(captured.values, v),
	getVariableValue: (id) => captured.values[id],
	sharedUdpSocketHandlers: new Map(),
	sharedUdpSocketJoin: async () => '',
	sharedUdpSocketLeave: async () => {},
	sharedUdpSocketSend: async () => {},
}

const instance = new ChurchTranslatorInstance(context)
await instance.init({ baseUrl, sessionId: 'Sunday', pollSeconds: 3 }, true, { token })

console.log('connection status :', captured.status.at(-1))
console.log('actions           :', Object.keys(captured.actions).length, '→', Object.keys(captured.actions).join(', '))
console.log('feedbacks         :', Object.keys(captured.feedbacks).join(', '))
console.log('language choices  :', instance.languageChoices.length)
console.log(
	'  sample          :',
	instance.languageChoices.slice(0, 2).map((c) => c.label),
)
console.log(
	'  flagged sample  :',
	instance.languageChoices
		.filter((c) => c.label.includes('not in current'))
		.slice(0, 2)
		.map((c) => c.label),
)
console.log(
	'preset sections   :',
	captured.presets.structure.map((s) => `${s.name} (${s.definitions.length})`).join(' | '),
)
console.log(
	'language presets  :',
	Object.keys(captured.presets.presets)
		.filter((k) => k.startsWith('speak_'))
		.join(', '),
)
console.log(
	'variables         : status=%s engine=%s speaker=%s (%s)',
	captured.values.status,
	captured.values.engine,
	captured.values.source_language,
	captured.values.source_language_label,
)

await captured.actions.set_source_language.callback({ options: { code: 'uk' } })
console.log('after set → uk    :', captured.values.source_language, '/', captured.values.source_language_label)
console.log('uk button lit     :', captured.feedbacks.source_language_is.callback({ options: { code: 'uk' } }))
console.log('ru button lit     :', captured.feedbacks.source_language_is.callback({ options: { code: 'ru' } }))
console.log('live feedback     :', captured.feedbacks.service_live.callback({ options: {} }))

await captured.actions.set_source_language.callback({ options: { code: 'ru' } })
console.log('restored          :', captured.values.source_language)

// A revoked/garbage token must read as an auth failure, not a network blip.
const bad = new ChurchTranslatorInstance({ ...context, id: 'smoke2' })
await bad.init({ baseUrl, sessionId: 'Sunday' }, true, { token: 'definitely-not-a-token' })
console.log('bad token status  :', captured.status.at(-1))
await bad.destroy()
await instance.destroy()
