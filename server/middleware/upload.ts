import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import type { Request } from "express";

/**
 * File upload middleware. Whitelists image extensions AND verifies magic
 * numbers (the actual bytes, not just the filename) to defeat
 * extension-spoofing attacks. Rejects anything that doesn't match.
 *
 * Whitelist: jpg, jpeg, png, gif, webp (matches the plan's accept criteria).
 * Max size: 10 MB per file. Disk storage under /uploads (served statically).
 */

export const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const ALLOWED_IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const uploadsDir = process.env.UPLOADS_DIR || "uploads";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    // randomBytes + timestamp avoids collisions and keeps filenames unguessable
    const { randomBytes } = require("crypto") as typeof import("crypto");
    const ext = (file.originalname.split(".").pop() || "").toLowerCase();
    cb(null, `${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`);
  },
});

/**
 * Multer instance that writes to disk. Validation happens AFTER the file is
 * buffered (memoryStorage) so we can inspect the magic numbers — for the
 * disk-backed upload below, we re-read and validate in the route handler.
 */
export const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_IMAGE_EXT.has(ext)) {
      return cb(new Error(`Unsupported file extension: .${ext}`));
    }
    cb(null, true);
  },
});

/**
 * Validates a single Multer.File by reading its bytes and confirming the
 * magic number matches the declared extension. Throws on failure.
 */
export async function validateImageBuffer(file: Express.Multer.File): Promise<void> {
  if (!file) throw new Error("No file uploaded");
  const ext = (file.originalname.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    throw new Error(`Unsupported file extension: .${ext}`);
  }
  const { readFile } = await import("fs/promises");
  const buf = await readFile(file.path);
  const detected = await fileTypeFromBuffer(buf);
  if (!detected || !ALLOWED_IMAGE_MIME.has(detected.mime)) {
    throw new Error(
      `File contents do not match a whitelisted image type (detected: ${detected?.mime ?? "unknown"})`,
    );
  }
  // Defence in depth: extension must agree with detected mime
  const extToMime: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp",
  };
  if (extToMime[ext] !== detected.mime) {
    throw new Error(
      `Extension .${ext} does not match detected MIME ${detected.mime}`,
    );
  }
}

/**
 * Validates the single file on a req after multer.single(). Use:
 *
 *   app.post(path, upload.single("image"), async (req, res) => {
 *     await validateUploadedImage(req);
 *     ...
 *   });
 */
export async function validateUploadedImage(req: Request): Promise<void> {
  if (!req.file) throw new Error("No file uploaded");
  return validateImageBuffer(req.file);
}
