type ConsoleMethod = 'log' | 'info' | 'warn' | 'error';

const PATCHED = Symbol.for('github-subscribe-bot.logger.patched');

function createFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function setupLogging(): void {
  const scopedGlobal = globalThis as typeof globalThis & {
    [PATCHED]?: boolean;
  };

  if (scopedGlobal[PATCHED]) return;

  const tz = process.env.TIMEZONE || process.env.TZ || 'Asia/Shanghai';
  const dtf = createFormatter(tz);
  const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error'];

  for (const method of methods) {
    const original = console[method].bind(console) as (...args: unknown[]) => void;

    const withTimestamp = (...args: unknown[]) => {
      original(`[${dtf.format(new Date())}]`, ...args);
    };

    console[method] = withTimestamp as Console[typeof method];
  }

  scopedGlobal[PATCHED] = true;
}
