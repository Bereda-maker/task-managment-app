import { config } from "../config";

type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

type Fields = Record<string, unknown>;

/** Turns anything thrown into loggable fields. Never includes request bodies or headers. */
export function errorFields(err: unknown): Fields {
  if (err instanceof Error) return { errName: err.name, errMessage: err.message, stack: err.stack };
  return { errMessage: String(err) };
}

function write(level: Level, msg: string, fields: Fields = {}) {
  if (RANK[level] < RANK[config.LOG_LEVEL]) return;

  if (config.isProd) {
    // One JSON object per line — what log aggregators (Datadog, Loki, CloudWatch…) expect.
    console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }));
    return;
  }
  const { stack, ...rest } = fields;
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
  const line = `${level.toUpperCase().padEnd(5)} ${msg}${extra}`;
  (level === "error" ? console.error : console.log)(line);
  if (typeof stack === "string") console.error(stack);
}

export const log = {
  debug: (msg: string, fields?: Fields) => write("debug", msg, fields),
  info: (msg: string, fields?: Fields) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields) => write("error", msg, fields),
};
