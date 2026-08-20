export const EAST_EIGHT_TIME_ZONE = 'Asia/Shanghai'

const businessDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: EAST_EIGHT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * 把绝对时间投影为模拟器统一使用的东八区业务日。
 *
 * 不能使用宿主机的 getFullYear/getMonth/getDate；否则同一记录会在
 * 不同开发者电脑或 CI 运行器上落入不同封发日期。
 */
export function businessCalendarDay(value: string | Date): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }
  const parts = Object.fromEntries(businessDateFormatter
    .formatToParts(parsed)
    .map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function isValidBusinessCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  return businessCalendarDay(`${value}T12:00:00+08:00`) === value
}

/**
 * 在东八区业务日上做整日位移，避免借用宿主机时区或截断 UTC 字符串。
 */
export function shiftBusinessCalendarDay(value: string, offsetDays: number): string {
  if (!isValidBusinessCalendarDay(value) || !Number.isInteger(offsetDays)) return ''
  const parsed = new Date(`${value}T12:00:00+08:00`)
  parsed.setUTCDate(parsed.getUTCDate() + offsetDays)
  return businessCalendarDay(parsed)
}
