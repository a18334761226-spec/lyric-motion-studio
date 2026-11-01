import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, DATA_DIR } from './config';
import type { Project, Song } from '../shared/types';
import { seedSongs } from './seed/songs';

/**
 * 使用 Node 内置 node:sqlite（无需原生编译，Windows 沙箱环境下同样可用）。
 */
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  aspect TEXT NOT NULL,
  cover_url TEXT,
  video_url TEXT,
  duration REAL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);

CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  language TEXT NOT NULL DEFAULT 'zh',
  tags TEXT NOT NULL DEFAULT '[]',
  lrc TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'local',
  source_label TEXT,
  duration_sec REAL,
  line_count INTEGER NOT NULL DEFAULT 0,
  excerpt TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at DESC);
`);

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/* ---------------------------- songs ---------------------------- */

interface SongRow {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  language: string;
  tags: string;
  lrc: string;
  source: Song['source'];
  source_label: string | null;
  duration_sec: number | null;
  line_count: number;
  excerpt: string | null;
  created_at: number;
}

function rowToSong(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: row.album ?? undefined,
    language: row.language,
    tags: safeJson<string[]>(row.tags, []),
    lrc: row.lrc,
    source: row.source,
    sourceLabel: row.source_label ?? undefined,
    durationSec: row.duration_sec ?? undefined,
    lineCount: row.line_count,
    excerpt: row.excerpt ?? undefined,
    createdAt: row.created_at,
  };
}

export function seedDatabase(): void {
  const count = db.prepare('SELECT COUNT(*) AS c FROM songs').get() as { c: number };
  if (count.c > 0) return;
  const insert = db.prepare(`
    INSERT INTO songs (id, title, artist, album, language, tags, lrc, source, source_label, duration_sec, line_count, excerpt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const songs = seedSongs(Date.now());
  db.exec('BEGIN');
  try {
    for (const s of songs) {
      insert.run(
        s.id,
        s.title,
        s.artist,
        s.album ?? null,
        s.language,
        JSON.stringify(s.tags),
        s.lrc,
        s.source,
        s.sourceLabel ?? null,
        s.durationSec ?? null,
        s.lineCount,
        s.excerpt ?? null,
        s.createdAt,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listSongs(limit = 100): Song[] {
  const rows = db.prepare('SELECT * FROM songs ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as SongRow[];
  return rows.map(rowToSong);
}

export function searchSongsLocal(q: string, limit = 30): Song[] {
  const term = q.trim();
  if (!term) return listSongs(limit);
  const like = `%${term.replace(/[%_]/g, '')}%`;
  const rows = db
    .prepare(
      `SELECT * FROM songs
       WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? OR tags LIKE ? OR excerpt LIKE ? OR lrc LIKE ?
       ORDER BY (title LIKE ?) DESC, created_at DESC LIMIT ?`,
    )
    .all(like, like, like, like, like, like, like, limit) as unknown as SongRow[];
  return rows.map(rowToSong);
}

export function getSong(id: string): Song | undefined {
  const row = db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as unknown as SongRow | undefined;
  return row ? rowToSong(row) : undefined;
}

export function insertSong(song: Song): void {
  db.prepare(
    `INSERT OR REPLACE INTO songs (id, title, artist, album, language, tags, lrc, source, source_label, duration_sec, line_count, excerpt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    song.id,
    song.title,
    song.artist,
    song.album ?? null,
    song.language,
    JSON.stringify(song.tags),
    song.lrc,
    song.source,
    song.sourceLabel ?? null,
    song.durationSec ?? null,
    song.lineCount,
    song.excerpt ?? null,
    song.createdAt,
  );
}

export function songCount(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM songs WHERE line_count > 0').get() as { c: number }).c;
}

/* --------------------------- projects -------------------------- */

export function saveProject(project: Project): void {
  db.prepare(
    `INSERT INTO projects (id, title, brief, status, stage, aspect, cover_url, video_url, duration, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, brief=excluded.brief, status=excluded.status, stage=excluded.stage,
       aspect=excluded.aspect, cover_url=excluded.cover_url, video_url=excluded.video_url,
       duration=excluded.duration, data=excluded.data, updated_at=excluded.updated_at`,
  ).run(
    project.id,
    project.title,
    project.requirements.brief,
    project.status,
    project.stage,
    project.render.aspect,
    project.assets.coverUrl ?? null,
    project.assets.videoUrl ?? null,
    project.assets.videoDuration ?? null,
    JSON.stringify(project),
    project.createdAt,
    project.updatedAt,
  );
}

export function getProject(id: string): Project | undefined {
  const row = db.prepare('SELECT data FROM projects WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Project) : undefined;
}

export function listProjects(limit = 100): Project[] {
  const rows = db.prepare('SELECT data FROM projects ORDER BY updated_at DESC LIMIT ?').all(limit) as unknown as {
    data: string;
  }[];
  return rows.map((r) => JSON.parse(r.data) as Project);
}

export function deleteProject(id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/* --------------------------- settings ------------------------- */

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    key,
    value,
  );
}

export function allSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as unknown as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/* --------------------------- activity ------------------------- */

export function addActivity(projectId: string | null, level: string, message: string): void {
  db.prepare('INSERT INTO activity (id, project_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)').run(
    Math.random().toString(36).slice(2) + Date.now().toString(36),
    projectId,
    level,
    message,
    Date.now(),
  );
  db.prepare('DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY created_at DESC LIMIT 200)').run();
}

export function listActivity(
  limit = 20,
): { id: string; projectId?: string; level: 'info' | 'success' | 'warn' | 'error'; message: string; createdAt: number }[] {
  const rows = db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT ?').all(limit) as unknown as {
    id: string;
    project_id: string | null;
    level: 'info' | 'success' | 'warn' | 'error';
    message: string;
    created_at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id ?? undefined,
    level: r.level,
    message: r.message,
    createdAt: r.created_at,
  }));
}

seedDatabase();
