import crypto from 'node:crypto';

export class Logger {
  constructor(private readonly context: Record<string, string> = {}) {}

  public child(extra: Record<string, string>) {
    return new Logger({ ...this.context, ...extra });
  }

  public info(message: string, meta: Record<string, unknown> = {}) {
    this.log('info', message, meta);
  }

  public warn(message: string, meta: Record<string, unknown> = {}) {
    this.log('warn', message, meta);
  }

  public error(message: string, meta: Record<string, unknown> = {}) {
    this.log('error', message, meta);
  }

  private log(level: string, message: string, meta: Record<string, unknown>) {
    const payload = {
      level,
      message,
      time: new Date().toISOString(),
      ...this.context,
      ...meta
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
}

export function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}
