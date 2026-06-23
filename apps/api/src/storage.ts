import { promises as fs } from "node:fs";
import { join, extname } from "node:path";
import { randomBytes } from "node:crypto";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");

async function ensureDir(): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export function makeStorageKey(fileName: string): string {
  const ext = extname(fileName).toLowerCase() || ".bin";
  return `${randomBytes(12).toString("hex")}${ext}`;
}

export async function saveFile(key: string, base64Data: string): Promise<void> {
  await ensureDir();
  const buffer = Buffer.from(base64Data, "base64");
  await fs.writeFile(join(UPLOAD_DIR, key), buffer);
}

export async function readFile(key: string): Promise<Buffer> {
  return fs.readFile(join(UPLOAD_DIR, key));
}

export function mimeFromKey(key: string): string {
  const ext = (key.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] ?? "application/octet-stream";
}
