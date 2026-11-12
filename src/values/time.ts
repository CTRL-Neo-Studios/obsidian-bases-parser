import dayjs from 'dayjs'
import advancedFormat from 'dayjs/plugin/advancedFormat.js'
import localizedFormat from 'dayjs/plugin/localizedFormat.js'
import weekOfYear from 'dayjs/plugin/weekOfYear.js'

dayjs.extend(advancedFormat)
dayjs.extend(localizedFormat)
dayjs.extend(weekOfYear)

/**
 * A duration as Obsidian keeps it: calendar months and days apart from clock time, so `"1M"` is a month whatever its
 * length and `"18M"` humanizes as "2 years". Its sizes are measured from `anchor` (the clock when it was made), as
 * Obsidian measures them from now: `duration("2M").days` is 61 on 12 November.
 */
export interface Duration {
	months: number
	days: number
	ms: number
	anchor: number
}

const DAY = 864e5
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * `YYYY-MM-DD`, optionally with ` HH:mm[:ss[.fff]]` or `THH:mm…` and a zone (then shown in local time). An impossible
 * day rolls over (`2026-02-30` is 2 March) but a month outside 1–12 is an invalid date (NaN), as in Obsidian.
 * Anything else isn't a date (null).
 */
export function parseDate(text: string): {ms: number; time: boolean} | null {
	const m = DATE.exec(text)
	if (!m) return null
	const [y, mo, d, h, mi, s] = m.slice(1, 7).map(x => Number(x ?? 0)) as number[]
	const ms = m[7] ? Number(`0.${m[7]}`) * 1000 | 0 : 0
	const time = m[4] !== undefined
	if (mo! < 1 || mo! > 12) return {ms: NaN, time}
	if (m[8]) {
		const zone = m[8] === 'Z' ? 0 : (m[8][0] === '-' ? -1 : 1) * (Number(m[8].slice(1, 3)) * 60 + Number(m[8].slice(-2)))
		return {ms: Date.UTC(y!, mo! - 1, d, h, mi, s, ms) - zone * 6e4, time}
	}
	return {ms: new Date(y!, mo! - 1, d, h, mi, s, ms).getTime(), time}
}

/** `2026-11-20` or `2026-11-20T10:30:00`, local time; an invalid date prints as Obsidian prints it. */
export function dateToString(ms: number, time: boolean): string {
	if (Number.isNaN(ms)) return '0NaN-NaN-NaN'
	return dayjs(ms).format(time ? 'YYYY-MM-DDTHH:mm:ss' : 'YYYY-MM-DD')
}

/** How a cell shows a date: `11/20/2026` or `11/20/2026 10:30 AM`. */
export function dateToDisplay(ms: number, time: boolean): string {
	if (Number.isNaN(ms)) return 'Invalid date'
	return dayjs(ms).format(time ? 'MM/DD/YYYY h:mm A' : 'MM/DD/YYYY')
}

/** Moment.js format tokens; an empty format is ISO 8601 with the offset. */
export function formatDate(ms: number, format: string): string {
	return dayjs(ms).format(format || undefined)
}

export function startOfDay(ms: number): number {
	const d = new Date(ms)
	d.setHours(0, 0, 0, 0)
	return d.getTime()
}

const UNITS: Record<string, [keyof Omit<Duration, 'anchor'>, number]> = {
	y: ['months', 12], year: ['months', 12], years: ['months', 12],
	M: ['months', 1], month: ['months', 1], months: ['months', 1],
	w: ['days', 7], week: ['days', 7], weeks: ['days', 7],
	d: ['days', 1], day: ['days', 1], days: ['days', 1],
	h: ['ms', 36e5], hour: ['ms', 36e5], hours: ['ms', 36e5],
	m: ['ms', 6e4], minute: ['ms', 6e4], minutes: ['ms', 6e4],
	s: ['ms', 1e3], second: ['ms', 1e3], seconds: ['ms', 1e3],
}
const SIMPLE = /^(-)?(\d+) ?([a-zA-Z]+)$/
// ISO 8601 needs its time part in Obsidian: `PT1H` and `P1Y2M3DT4H5M6S` parse, `P1D` doesn't.
const ISO = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/

/** `"1d"`, `"2 days"`, `"-3h"`, `"1M"` (month), `"1m"` (minute), `"PT1H"`. Anything else is null. */
export function parseDuration(text: string, anchor: number): Duration | null {
	const simple = SIMPLE.exec(text)
	if (simple) {
		const unit = UNITS[simple[3]!]
		if (!unit) return null
		const duration: Duration = {months: 0, days: 0, ms: 0, anchor}
		duration[unit[0]] = (simple[1] ? -1 : 1) * Number(simple[2]) * unit[1]
		return duration
	}
	const iso = ISO.exec(text)
	if (!iso) return null
	const [y, mo, w, d, h, mi, s] = iso.slice(1).map(n => Number(n ?? 0)) as number[]
	return {months: y! * 12 + mo!, days: w! * 7 + d!, ms: h! * 36e5 + mi! * 6e4 + s! * 1e3, anchor}
}

/** Adds on the wall clock, as Obsidian does: `+ "24h"` keeps the hour across a DST change, and 31 January + 1 month is 3 March. */
export function addDuration(ms: number, duration: Omit<Duration, 'anchor'>, sign: 1 | -1 = 1): number {
	const d = new Date(ms)
	if (duration.months) d.setMonth(d.getMonth() + sign * duration.months)
	if (duration.days) d.setDate(d.getDate() + sign * duration.days)
	if (duration.ms) d.setMilliseconds(d.getMilliseconds() + sign * duration.ms)
	return d.getTime()
}

export function durationEnd(duration: Duration): number {
	return addDuration(duration.anchor, duration)
}

/** Length in milliseconds of real time from the anchor. */
export function durationMs(duration: Duration): number {
	return durationEnd(duration) - duration.anchor
}

const FIELDS = ['milliseconds', 'seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const
export type DurationField = (typeof FIELDS)[number]
export const isDurationField = (key: string): key is DurationField => (FIELDS as readonly string[]).includes(key)

/** A duration's size in one unit, measured like Moment's `diff`: days on the calendar, months by month lengths. */
export function durationIn(duration: Duration, field: DurationField): number {
	return diff(durationEnd(duration), duration.anchor, field)
}

function diff(end: number, start: number, field: DurationField): number {
	const raw = end - start
	switch (field) {
		case 'milliseconds': return raw
		case 'seconds': return raw / 1e3
		case 'minutes': return raw / 6e4
		case 'hours': return raw / 36e5
		case 'days':
		case 'weeks': {
			// Calendar days: a day that DST shortens still counts as one.
			const zone = (new Date(end).getTimezoneOffset() - new Date(start).getTimezoneOffset()) * 6e4
			return (raw - zone) / (field === 'days' ? DAY : 7 * DAY)
		}
		case 'months': return monthDiff(end, start)
		case 'years': return monthDiff(end, start) / 12
	}
}

// Whole months between the two, plus the fraction of the month around the end (Moment's algorithm).
function monthDiff(a: number, b: number): number {
	const da = new Date(a)
	const db = new Date(b)
	if (da.getDate() < db.getDate()) return -monthDiff(b, a)
	const whole = (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth())
	const anchor = addMonthsClamped(a, whole)
	let adjust: number
	if (b - anchor < 0) adjust = (b - anchor) / (anchor - addMonthsClamped(a, whole - 1))
	else adjust = (b - anchor) / (addMonthsClamped(a, whole + 1) - anchor)
	return -(whole + adjust) || 0
}

function addMonthsClamped(ms: number, months: number): number {
	const d = new Date(ms)
	const day = d.getDate()
	d.setDate(1)
	d.setMonth(d.getMonth() + months)
	d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
	return d.getTime()
}

/** "a few seconds", "2 hours", "a month", "2 years": the span from `start` to `end`, rounded as Moment rounds it. */
export function humanize(start: number, end: number): string {
	const abs = (field: DurationField) => Math.round(Math.abs(diff(end, start, field)))
	const seconds = abs('seconds')
	const minutes = abs('minutes')
	const hours = abs('hours')
	const days = abs('days')
	const months = abs('months')
	const years = abs('years')
	if (seconds <= 44) return 'a few seconds'
	if (minutes <= 1) return 'a minute'
	if (minutes < 45) return `${minutes} minutes`
	if (hours <= 1) return 'an hour'
	if (hours < 22) return `${hours} hours`
	if (days <= 1) return 'a day'
	if (days < 26) return `${days} days`
	if (months <= 1) return 'a month'
	if (months < 11) return `${months} months`
	if (years <= 1) return 'a year'
	return `${years} years`
}

/** "in 7 days", "3 hours ago". */
export function relative(ms: number, now: number): string {
	const text = humanize(now, ms)
	return ms >= now ? `in ${text}` : `${text} ago`
}
