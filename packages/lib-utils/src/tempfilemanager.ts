
import { mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { uid } from 'uid';

export class TempManager {

  #dir_path: string;

  constructor() {
    this.#dir_path = resolve(tmpdir(), `harness-${uid()}`);
    mkdirSync(this.#dir_path, { recursive: true });
    process.on('beforeExit', this.#onBeforeExit);
  }

  async writeFile(content: string): Promise<string> {
    const file_path = resolve(this.#dir_path, uid());
    await writeFile(file_path, content, 'utf8');
    return file_path;
  }

  #onBeforeExit() {
    rmSync(this.#dir_path, { recursive: true, maxRetries: 3 });
  }

}
