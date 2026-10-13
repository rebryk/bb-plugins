import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

type Reply = { ready?: true; id?: number; text?: string; error?: string };

/**
 * One recognizer that stays up between takes, so its graphs are open and
 * compiled for the Neural Engine. JSON lines go in and come back in order.
 */
export class RecognizerProcess {
  /** Resolves once the graphs are open and warm. */
  readonly ready: Promise<void>;
  /** Resolves with the reason the process ended. */
  readonly exited: Promise<Error>;
  private readonly child;
  private readonly pending = new Map<
    number,
    { resolve: (text: string) => void; reject: (error: Error) => void }
  >();
  private next = 1;
  private failure: Error | null = null;

  constructor(command: string, args: string[]) {
    this.child = spawn(command, args);
    let started = (_: Reply) => {};
    this.ready = new Promise((resolve, reject) => {
      started = (reply) =>
        reply.ready ? resolve() : reject(new Error(reply.error));
    });

    createInterface({ input: this.child.stdout }).on("line", (line) => {
      let reply: Reply;
      try {
        reply = JSON.parse(line);
      } catch {
        return;
      }
      if (reply.id === undefined) return started(reply);
      const request = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      if (reply.error !== undefined) request?.reject(new Error(reply.error));
      else request?.resolve(reply.text ?? "");
    });

    // A write after the process died fails here; its exit rejects the take.
    this.child.stdin.on("error", () => {});
    let stderr = "";
    this.child.stderr.on(
      "data",
      (chunk) => (stderr = (stderr + chunk).slice(-2000)),
    );
    this.exited = new Promise((resolve) => {
      const end = (cause: string) => {
        this.failure ??= new Error(
          stderr.trim().split("\n").pop() || `The recognizer ${cause}`,
        );
        started({ error: this.failure.message });
        for (const request of this.pending.values())
          request.reject(this.failure);
        this.pending.clear();
        resolve(this.failure);
      };
      this.child.on("error", (error) => end(`failed: ${error.message}`));
      this.child.on("exit", (code, signal) =>
        end(`exited with ${signal ?? code}`),
      );
    });
  }

  /**
   * The text of the take in `audio`, a mono file AVAudioFile reads. A take
   * that BB stops waiting for stops the recognizer, so later takes need not
   * wait for it; the next take starts a new one.
   */
  transcribe(audio: string, signal: AbortSignal): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      signal.addEventListener("abort", () => this.close(), { once: true });
      this.child.stdin.write(JSON.stringify({ id, audio }) + "\n");
    });
  }

  close(): void {
    this.child.kill();
  }
}
