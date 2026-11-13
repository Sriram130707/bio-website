type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp";

const signatures: Record<SupportedImageMime, (buffer: Buffer) => boolean> = {
  "image/jpeg": (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  "image/png": (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  "image/webp": (buffer) => buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP",
};

export const supportedImageMimes = Object.keys(signatures) as SupportedImageMime[];

export function isSupportedImageMime(value: string): value is SupportedImageMime {
  return Object.prototype.hasOwnProperty.call(signatures, value);
}

export function hasValidImageSignature(file: Express.Multer.File): boolean {
  return isSupportedImageMime(file.mimetype) && signatures[file.mimetype](file.buffer);
}
