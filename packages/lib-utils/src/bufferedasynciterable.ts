import { Deferred } from "./utils.js";
// import { ArrayQueue } from "./arrayqueue.js";
import { LinkedList } from "./linkedlist.js";

/**
 * An Async Queue is a queue that can be used to push items to it and then wait
 * for them to be consumed.
 *
 * The queue supports two termination modes:
 * - `end()`: Stops accepting new items but allows iteration to drain remaining buffered items
 * - `close()`: Forcefully stops iteration immediately, regardless of buffer state
 *
 * Note: Backpressure is not implemented. Producers are responsible for managing their own
 * rate if unbounded buffering is a concern. This is intentional—simpler, and backpressure
 * should be handled at a higher architectural level (e.g., WebSocket flow control).
 *
 * @example
 * ```ts
 * const queue = new AsyncQueue<string>();
 * queue.push("hello");
 * for await (const item of queue) {
 *   console.log(item); // "hello"
 * }
 * ```
 */
export class BufferedAsyncIterable<T> implements AsyncIterable<T> {

  readonly #buffer: LinkedList<T>;

  #ended: boolean;
  #closed: boolean;

  #next?: Deferred<void>;

  constructor() {
    this.#buffer = new LinkedList();
    this.#ended = false;
    this.#closed = false;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Awaited<T>, void, unknown> {
    while (!this.#closed) {
      if (this.#buffer.length > 0) {
        yield this.#buffer.shift()!;
      } else {
        if (this.#ended) {
          return;
        }
        if (!this.#next) {
          this.#next = new Deferred<void>();
        }
        await this.#next!.promise;
      }
    }
  }

  #resolveNext(): void {
    const next = this.#next;
    if (next) {
      this.#next = undefined;
      queueMicrotask(next.resolve);
    }
  }

  end(): void {
    this.#ended = true;
    this.#resolveNext();
  }

  get isEnded(): boolean {
    return this.#ended;
  }

  close(): void {
    this.#ended = true;
    this.#closed = true;
    this.#resolveNext();
  }

  get isClosed(): boolean {
    return this.#closed;
  }

  readonly push = (item: T): void => {
    if (this.#closed) {
      throw new Error('Cannot push to a closed iterable');
    }
    if (this.#ended) {
      throw new Error('Cannot push to an ended iterable');
    }
    this.#buffer.push(item);
    this.#resolveNext();
  };
}
