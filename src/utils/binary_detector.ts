/**
 * Content-based binary file detection.
 *
 * Whether a file is treated as binary is decided by inspecting its bytes rather
 * than its extension. This keeps the check language-agnostic: it never needs to
 * be updated as new languages or file types are supported, and it catches
 * binaries that happen to carry a text-like extension (or none at all).
 *
 * Only a leading portion of the file is examined, which is enough to classify
 * the vast majority of files and avoids reading large binaries in full.
 */

/** Number of leading bytes inspected when classifying a file. */
const SAMPLE_SIZE = 8192;

/**
 * Proportion of non-text bytes in the sample above which a file with no NUL
 * byte is still treated as binary. Real text files occasionally contain stray
 * control characters, so a small tolerance avoids misclassifying them.
 */
const NON_TEXT_THRESHOLD = 0.3;

/**
 * Determines whether a buffer's leading bytes look like binary content.
 *
 * A NUL byte is treated as a definitive signal, since it does not occur in
 * UTF-8 or other common text encodings. Absent a NUL byte, the sample is
 * classified by the share of bytes that fall outside the printable and common
 * whitespace ranges; this catches binaries that do not contain NUL bytes while
 * tolerating the occasional control character found in legitimate text.
 */
export function isBinaryContent(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, SAMPLE_SIZE);

  if (length === 0) {
    return false;
  }

  let nonTextCount = 0;

  for (let i = 0; i < length; i++) {
    const byte = buffer[i];

    // A NUL byte is the strongest indicator of binary content.
    if (byte === 0) {
      return true;
    }

    // Treat tab, line feed, carriage return, and form feed as text, along with
    // every printable byte from space (0x20) upward. Everything else in the
    // low control range is counted toward the non-text ratio.
    const isText =
      byte === 9 ||
      byte === 10 ||
      byte === 12 ||
      byte === 13 ||
      (byte >= 32 && byte <= 126) ||
      byte >= 128;

    if (!isText) {
      nonTextCount++;
    }
  }

  return nonTextCount / length > NON_TEXT_THRESHOLD;
}
