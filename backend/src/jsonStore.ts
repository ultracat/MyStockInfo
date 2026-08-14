import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal JSON-file store: reads the whole file into memory, writes are
 * atomic (write to temp file, then rename) to avoid corrupting the file if
 * the process is killed mid-write. Fine for single-user, low-write-volume
 * local data (settings, a personal dividend log) — not a database.
 */
export class JsonStore<T> {
  private readonly filePath: string;
  private readonly defaultValue: T;

  constructor(fileName: string, dataDir: string, defaultValue: T) {
    this.filePath = path.join(dataDir, fileName);
    this.defaultValue = defaultValue;
  }

  read(): T {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err: any) {
      if (err.code === 'ENOENT') return structuredClone(this.defaultValue);
      throw err;
    }
  }

  write(data: T): void {
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  update(mutator: (current: T) => T): T {
    const next = mutator(this.read());
    this.write(next);
    return next;
  }
}
