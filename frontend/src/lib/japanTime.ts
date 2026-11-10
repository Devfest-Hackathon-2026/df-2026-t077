/** Form values always represent Japan time, independent of the device timezone. */
export function toJapanDateTime(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Invalid Japan date/time')
  }
  const calendar = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid calendar date')
  }
  return `${date}T${time}:00+09:00`
}

export function fromJapanDateTime(value: string): { date: string; time: string } {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('An offset-aware timestamp is required')
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const part = (name: string) => parts.find((entry) => entry.type === name)!.value
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

export function japanTripWindow(date: string, start: string, end: string) {
  const start_at = toJapanDateTime(date, start)
  const end_at = toJapanDateTime(date, end)
  if (Date.parse(end_at) <= Date.parse(start_at)) throw new Error('End must follow start on the same Japan date')
  return { start_at, end_at }
}
