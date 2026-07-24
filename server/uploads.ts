import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const uploadsDir = path.resolve(__dirname, '../uploads');

export function ensureUploadsDir() {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export function uploadsFileFromPublicPath(publicPath: string): string | null {
  if (!publicPath.startsWith('/uploads/')) return null;
  const name = path.basename(publicPath);
  if (name !== publicPath.slice('/uploads/'.length)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
  return path.join(uploadsDir, name);
}

export function deleteUploadedFile(publicPath: string | null | undefined) {
  if (!publicPath) return;
  const file = uploadsFileFromPublicPath(publicPath);
  if (!file) return;
  fs.promises.unlink(file).catch(() => {});
}
