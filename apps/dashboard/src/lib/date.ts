/** UI 的时区由服务端配置传入，不使用浏览器所在时区。 */
export function formatTime(value: number | string, timezone: string, date = false) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(date ? ({ year: "numeric", month: "2-digit", day: "2-digit" } as const) : {}),
  }).format(new Date(value));
}

export function today(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
