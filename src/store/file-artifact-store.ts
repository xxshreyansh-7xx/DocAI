import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactStore } from "./interfaces";

export class FileArtifactStore implements ArtifactStore {
  constructor(private readonly baseDir: string) {}

  async savePdf(jobId: string, data: Uint8Array): Promise<{ path: string; url?: string }> {
    await mkdir(this.baseDir, { recursive: true });
    const filePath = path.join(this.baseDir, `${jobId}.pdf`);
    await writeFile(filePath, data);
    return { path: filePath };
  }
}
