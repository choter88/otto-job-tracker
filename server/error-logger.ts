import fs from 'fs';
import path from 'path';

interface ErrorLogEntry {
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  errorMessage: string;
  stack?: string;
  userId?: string;
  officeId?: string;
  requestBody?: any;
  duration?: number;
}

const LOG_FILE = '/tmp/error_log.json';
const MAX_ENTRIES = 1000;

function readLogFile(): ErrorLogEntry[] {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const content = fs.readFileSync(LOG_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // If file is corrupted, start fresh
  }
  return [];
}

function writeLogFile(entries: ErrorLogEntry[]): void {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
  } catch (e) {
    console.error('Failed to write error log:', e);
  }
}

export function logError(entry: ErrorLogEntry): void {
  const entries = readLogFile();
  entries.unshift(entry);
  
  // Keep only the last MAX_ENTRIES
  if (entries.length > MAX_ENTRIES) {
    entries.length = MAX_ENTRIES;
  }
  
  writeLogFile(entries);
}

export function getRecentErrors(limit: number = 100): ErrorLogEntry[] {
  const entries = readLogFile();
  return entries.slice(0, limit);
}

export function getErrorStats(): {
  total: number;
  byStatusCode: Record<number, number>;
  byPath: Record<string, number>;
  last24Hours: number;
  lastHour: number;
} {
  const entries = readLogFile();
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  
  const stats = {
    total: entries.length,
    byStatusCode: {} as Record<number, number>,
    byPath: {} as Record<string, number>,
    last24Hours: 0,
    lastHour: 0,
  };
  
  for (const entry of entries) {
    const entryTime = new Date(entry.timestamp).getTime();
    
    // Count by status code
    stats.byStatusCode[entry.statusCode] = (stats.byStatusCode[entry.statusCode] || 0) + 1;
    
    // Count by path (normalize dynamic segments)
    const normalizedPath = entry.path.replace(/\/[0-9a-f-]{36}/gi, '/:id').replace(/\/\d+/g, '/:id');
    stats.byPath[normalizedPath] = (stats.byPath[normalizedPath] || 0) + 1;
    
    // Time-based counts
    if (entryTime > dayAgo) stats.last24Hours++;
    if (entryTime > hourAgo) stats.lastHour++;
  }
  
  return stats;
}

export function clearErrors(): void {
  writeLogFile([]);
}
