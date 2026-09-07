import { AbstractSynthesisModel, type SynthesisResult } from "../abstract.js";
import { type ConfigSynthesisModelKokoro } from "../../../config/config.js";

/**
 * Adapter for the local Kokoro-82M container (kokoro-tts, kept warm
 * with sleep infinity). Execution stays inside the container — the
 * host never runs synthesis code (execution-isolation anchor):
 *
 *   docker exec kokoro-tts python3 /work/synth.py "<text>" <out_path>
 *
 * The in-container script (packages/harness/src/models/synthesis/
 * adapters/kokoro-synth.py, mirrored to /work/synth.py) runs
 * Kokoro-82M + the ten-stage filter chain and prints a JSON line
 * {path, duration, voice}. Duration comes from ffprobe of the FINAL
 * encoded file, so it is exact and survives any format change.
 *
 * The caller (speech server) allocates out_path via the FileManager.
 * Text travels as an argv argument — it is script-authored content,
 * never interpolated into a shell string.
 */
export class KokoroSynthesisModel extends AbstractSynthesisModel {

  #container: string;
  #script_path: string;
  #voice: string;

  constructor(opts: ConfigSynthesisModelKokoro) {
    super(opts);
    this.#container = opts.options.container ?? 'kokoro-tts';
    this.#script_path = opts.options.script_path ?? '/work/synth.py';
    this.#voice = opts.options.voice ?? 'bm_fable';
  }

  async synthesize(text: string, out_path?: string): Promise<SynthesisResult> {
    const format = 'ogg';
    const target = out_path ?? `/tmp/fondamenta-synthesis-${Date.now()}.${format}`;

    const args = [
      'exec',
      this.#container,
      'python3',
      this.#script_path,
      text,
      target,
      '--voice', this.#voice,
    ];

    const { execFile } = await import('node:child_process');
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile('docker', args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(new Error(`Kokoro synthesis failed: ${err.message}`));
        else resolve(stdout);
      });
    });

    // The script prints one JSON line as its last output line.
    const line = stdout.trim().split('\n').filter(l => l.trim()).pop();
    if (!line) throw new Error('Kokoro synthesis produced no JSON output');
    let parsed: { path?: string; duration?: number; voice?: string };
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Kokoro synthesis output is not JSON: ${line.slice(0, 200)}`);
    }
    if (typeof parsed.duration !== 'number' || !Number.isFinite(parsed.duration) || parsed.duration <= 0) {
      throw new Error(`Kokoro synthesis returned invalid duration: ${String(parsed.duration)}`);
    }
    return { path: target, duration: parsed.duration, format };
  }
}
