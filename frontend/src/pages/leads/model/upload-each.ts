/**
 * Uploads a selection of files one after another. A file that is too large
 * or that the server refuses does not stop the others (QA 2026-10-24: the
 * wizard stopped at the first refused file, and the files uploaded before it
 * stayed out of sight until a reload). Returns what failed, by file.
 */
export async function uploadEach<Item extends { name: string; size: number }>(
  files: readonly Item[],
  upload: (file: Item) => Promise<void>,
  maxBytes: number,
): Promise<{ uploaded: Item[]; tooLarge: Item[]; failed: { file: Item; error: unknown }[] }> {
  const uploaded: Item[] = [];
  const tooLarge: Item[] = [];
  const failed: { file: Item; error: unknown }[] = [];
  for (const file of files) {
    if (file.size > maxBytes) {
      tooLarge.push(file);
      continue;
    }
    try {
      await upload(file);
      uploaded.push(file);
    } catch (error) {
      failed.push({ file, error });
    }
  }
  return { uploaded, tooLarge, failed };
}
