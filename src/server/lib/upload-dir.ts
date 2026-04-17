import { resolve } from 'node:path';

export function getUploadDir(): string {
  return process.env.UPLOAD_DIR
    ? resolve(process.env.UPLOAD_DIR)
    : resolve(process.cwd(), 'uploads');
}
