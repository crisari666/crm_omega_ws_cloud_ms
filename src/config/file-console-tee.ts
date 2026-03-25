import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const DISABLE_FILE_LOG_ENV = 'DISABLE_FILE_LOG';
const LOG_FILE_ENV = 'LOG_FILE';

/**
 * Duplicates console output to a log file (append). Call once at process startup.
 * Set `DISABLE_FILE_LOG=1` to skip. Override path with `LOG_FILE` (default `logs/app.log`).
 */
export function enableFileConsoleTee(): void {
  if (process.env[DISABLE_FILE_LOG_ENV] === '1' || process.env[DISABLE_FILE_LOG_ENV] === 'true') {
    return;
  }
  const relativePath = process.env[LOG_FILE_ENV] ?? path.join('logs', 'app.log');
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(process.cwd(), relativePath);
  const logDirectory = path.dirname(absolutePath);
  if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory, { recursive: true });
  }
  const stream = fs.createWriteStream(absolutePath, { flags: 'a' });
  stream.on('error', (err: Error) => {
    process.stderr.write(`[file-console-tee] write failed: ${err.message}\n`);
  });
  const writeLine = (level: string, args: Parameters<typeof console.log>): void => {
    const formatted = util.format(...args);
    const line = `[${new Date().toISOString()}] [${level}] ${formatted}\n`;
    stream.write(line);
  };
  const originalLog = console.log.bind(console);
  const originalInfo = console.info.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);
  const originalDebug = console.debug.bind(console);
  console.log = (...args: Parameters<typeof console.log>) => {
    originalLog(...args);
    writeLine('LOG', args);
  };
  console.info = (...args: Parameters<typeof console.info>) => {
    originalInfo(...args);
    writeLine('INFO', args);
  };
  console.warn = (...args: Parameters<typeof console.warn>) => {
    originalWarn(...args);
    writeLine('WARN', args);
  };
  console.error = (...args: Parameters<typeof console.error>) => {
    originalError(...args);
    writeLine('ERROR', args);
  };
  console.debug = (...args: Parameters<typeof console.debug>) => {
    originalDebug(...args);
    writeLine('DEBUG', args);
  };
  process.once('beforeExit', () => {
    stream.end();
  });
}
