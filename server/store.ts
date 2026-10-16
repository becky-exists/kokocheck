import { errorMessages, type ErrorCode } from '../shared/errors.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Project } from '../shared/types.js';

export class HttpError extends Error {
  constructor(public status: number, public code: ErrorCode) { super(errorMessages[code].ja); }
}
export function check(condition: unknown, status: number, message: ErrorCode): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, updated TEXT NOT NULL, data TEXT NOT NULL);');
  }
  get(id: string): Project {
    const row = this.db.prepare('SELECT data FROM projects WHERE id = ?').get(id);
    check(row, 404, 'review_not_found');
    return JSON.parse(row.data as string) as Project;
  }
  list(limit = 50, offset = 0): { projects: Project[]; total: number } {
    const projects = this.db.prepare('SELECT data FROM projects ORDER BY updated DESC LIMIT ? OFFSET ?').all(limit, offset)
      .map(row => JSON.parse(row.data as string) as Project);
    return { projects, total: Number(this.db.prepare('SELECT count(*) as n FROM projects').get()!.n) };
  }
  create(project: Project) {
    this.db.prepare('INSERT INTO projects (id, updated, data) VALUES (?, ?, ?)').run(project.id, project.updatedAt, JSON.stringify(project));
    return project;
  }
  mutate<T>(id: string, action: (project: Project) => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const project = this.get(id);
      const result = action(project);
      project.updatedAt = new Date().toISOString();
      this.db.prepare('UPDATE projects SET updated = ?, data = ? WHERE id = ?').run(project.updatedAt, JSON.stringify(project), id);
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
