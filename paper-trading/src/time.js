// Display-only timezone conversion. Stored Unix timestamps remain unchanged.
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function parts(milliseconds) {
  return Object.fromEntries(formatter.formatToParts(new Date(milliseconds)).map(p => [p.type, p.value]));
}
export function formatBeijing(milliseconds) {
  const p = parts(milliseconds);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
function chartMilliseconds(time) {
  if (typeof time === 'number') return time * 1000;
  if (typeof time === 'string') return Date.parse(time + 'T00:00:00Z');
  return Date.UTC(time.year, time.month - 1, time.day);
}
export function chartTimeBeijing(time) {
  return formatBeijing(chartMilliseconds(time)) + ' UTC+8';
}
export function tickBeijing(time, type) {
  const p = parts(chartMilliseconds(time));
  if (type === 0) return p.year;
  if (type === 1) return `${p.year}-${p.month}`;
  if (type === 2) return `${p.month}-${p.day}`;
  return `${p.hour}:${p.minute}${type === 4 ? ':' + p.second : ''}`;
}
