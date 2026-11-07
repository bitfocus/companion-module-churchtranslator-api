/**
 * Drawing elements this module gives Companion (module API 2.1, Companion
 * 5.0+): the input level meter.
 *
 * Until 1.4.0 the meter was an advanced feedback that painted its ten
 * segments into an image buffer. Bitfocus's review of 1.3.1 (M2) pointed
 * out that advanced feedbacks are likely to go in a future major API
 * version, so now Companion draws it: the "Input level" value feedback
 * reports { mode, lit, hold } (health.js meterValue), the Input meter
 * preset binds that to a local variable, and this element turns the three
 * numbers into ten boxes. A user can drop the same element onto any
 * button of their own and feed it the same way.
 *
 * It looks as the bitmap did: the native Stream Deck plugin's colours,
 * unlit segments faintly visible so the scale reads in silence, the
 * peak-hold segment lit on its own, a white unlit scale in an alarm (the
 * words on the key say what is wrong, the empty bar says "no level"), and
 * nothing at all when the meter has nothing to say (off, unknown).
 */
import { combineRgb } from '@companion-module/base'
import { METER_STEPS, UNLIT_OPACITY, meterColor } from './health.js'

const WHITE = combineRgb(255, 255, 255)

const round = (n) => Math.round(n * 1000) / 1000

/**
 * Segment width and pitch (segment plus the gap after it), in percent of
 * the element. 5 : 2, as the bitmap's 5-pixel segments and 2-pixel gaps
 * were, so the ten segments and nine gaps fill the element exactly.
 */
const SEGMENT_WIDTH = round((100 * 5) / 68)
const SEGMENT_PITCH = round((100 * 7) / 68)

const expr = (value) => ({ isExpression: true, value })
const opt = (id) => `$(options:${id})`

/** The meter's modes, as the Input level feedback reports them (health.js inputView). */
export const METER_MODES = [
	{ id: 'live', label: 'Live — show the level' },
	{ id: 'paused', label: 'Paused — the scale, unlit' },
	{ id: 'nosound', label: 'NO SOUND — a white scale' },
	{ id: 'nofeed', label: 'NO FEED — a white scale' },
	{ id: 'off', label: 'Not live — hidden' },
	{ id: 'unknown', label: 'No level from the server — hidden' },
]

export function buildCompositeElements() {
	const alarm = `(${opt('mode')} == 'nosound' || ${opt('mode')} == 'nofeed')`
	const segments = METER_STEPS.map((db, i) => {
		const n = i + 1
		return {
			type: 'box',
			id: `segment_${n}`,
			name: `Segment ${n} (${db} dBFS)`,
			x: round(i * SEGMENT_PITCH),
			y: 0,
			width: SEGMENT_WIDTH,
			height: 100,
			color: expr(`${alarm} ? ${WHITE} : ${meterColor(db)}`),
			// Lit up to the level, plus the peak-hold segment on its own.
			opacity: expr(`!${alarm} && (${opt('lit')} >= ${n} || ${opt('hold')} == ${n}) ? 100 : ${UNLIT_OPACITY}`),
		}
	})

	return {
		input_meter: {
			type: 'composite',
			name: 'Input level meter',
			description:
				'Ten level segments in OBS colours (green below -20 dBFS, yellow to -9, red above) with a peak-hold ' +
				'segment: what the SERVER hears, so a moving bar proves the whole path from the mixer to the cloud. ' +
				'Feed it from the "Input level" feedback: add a local variable of that feedback (say "level") and set ' +
				'the three options to the expressions $(local:level).mode, $(local:level).lit and $(local:level).hold. ' +
				'The Input meter preset comes wired up.',
			// All three accept expressions — that is how the feedback reaches
			// them — so none of them sets disableAutoExpression.
			options: [
				{
					type: 'dropdown',
					id: 'mode',
					label: 'State',
					tooltip: 'Usually $(local:level).mode, from the Input level feedback',
					default: 'live',
					choices: METER_MODES,
				},
				{
					type: 'number',
					id: 'lit',
					label: 'Lit segments (0-10)',
					tooltip: 'Usually $(local:level).lit, from the Input level feedback',
					default: 0,
					min: 0,
					max: METER_STEPS.length,
				},
				{
					type: 'number',
					id: 'hold',
					label: 'Peak-hold segment (0 = none)',
					tooltip: 'Usually $(local:level).hold, from the Input level feedback',
					default: 0,
					min: 0,
					max: METER_STEPS.length,
				},
			],
			elements: [
				{
					type: 'group',
					id: 'scale',
					name: 'Scale',
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					enabled: expr(`${opt('mode')} != 'off' && ${opt('mode')} != 'unknown'`),
					children: segments,
				},
			],
		},
	}
}
