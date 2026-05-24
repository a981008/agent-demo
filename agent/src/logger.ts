/**
 * 日志模块
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LogLevelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel = 'info';
  private prefixes: string[] = [];
  private _parent: Logger | null = null;

  setLevel(level: LogLevel) {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private getEffectiveLevel(): LogLevel {
    if (this._parent) {
      return this._parent.getEffectiveLevel();
    }
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LogLevelPriority[level] >= LogLevelPriority[this.getEffectiveLevel()];
  }

  private format(level: LogLevel, message: string, ...args: any[]): string {
    const ts = new Date().toISOString();
    const prefix = this.prefixes.join(' ');
    const gray = '\x1b[90m';
    const reset = '\x1b[0m';

    let output = message;
    for (const arg of args) {
      const formatted = typeof arg === 'string' ? arg : JSON.stringify(arg);
      output = output.replace('{}', formatted);
    }

    return `${gray}[${ts}] [${level.toUpperCase()}]${prefix ? ` ${prefix}` : ''} ${output}${reset}`;
  }

  debug(message: string, ...args: any[]) {
    if (this.shouldLog('debug')) {
      console.log(this.format('debug', message, ...args));
    }
  }

  info(message: string, ...args: any[]) {
    if (this.shouldLog('info')) {
      console.log(this.format('info', message, ...args));
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.shouldLog('warn')) {
      console.warn(this.format('warn', message, ...args));
    }
  }

  error(message: string, ...args: any[]) {
    if (this.shouldLog('error')) {
      console.error(this.format('error', message, ...args));
    }
  }

  child(prefix: string): Logger {
    const child = new Logger();
    child.level = this.level;
    child.prefixes = [...this.prefixes, prefix];
    child._parent = this;
    return child;
  }
}

const logger = new Logger();

export function createLogger(prefix: string): Logger {
  return logger.child(prefix);
}
