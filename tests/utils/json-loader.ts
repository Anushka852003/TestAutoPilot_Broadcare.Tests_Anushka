import fs from 'fs';
import path from 'path';

export function loadJsonArray<T>(filePath: string, baseDir: string): T[] {
  const resolvedPath = path.resolve(baseDir, filePath);

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return [];
    }

    throw error;
  }
}