
import { exec, ExecOptions, ExecOptionsWithBufferEncoding, ExecOptionsWithStringEncoding } from 'node:child_process';

// import { ValidationErrorItem } from '@runtyped/type';
// import { tmpdir } from 'node:os';
import { AddressInfo } from 'node:net';

export const runAsyncMain = async (fn: () => Promise<void>) => {
    try {
        await fn();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
};

// export const validationErrsToString = (errs: ValidationErrorItem[]): string => {
export const validationErrsToString = (errs: { path: string; message: string; }[]): string => {
  return errs.map(err => `${err.path}: ${err.message}`).join(', ');
};

export class Deferred<T> {
    promise: Promise<T>;
    resolve!: (value: T | PromiseLike<T>) => void;
    reject!: (reason?: any) => void;
    constructor() {
      this.promise = new Promise<T>((resolve, reject) => {
          this.resolve = resolve;
          this.reject = reject;
      });
    }
}

export const errToString = (err: Error | any, hide_stack?: boolean): string => {
  if (err instanceof Error) {
    return hide_stack ? err.message : (err.stack ?? err.message);
  }
  if (typeof err === 'object' && err !== 'null') {
    return Object.prototype.toString.call(err.message ?? err);
  }
  return Object.prototype.toString.call(err);
};

export const setMap = <I, O>(set: Set<I>, fn: (item: I) => O): O[] => {
  const res: O[] = new Array(set.size);
  let idx = 0;
  set.forEach((item) => {
    res[idx++] = fn(item);
  });
  return res;
};

export async function execAsync(command: string, opts?: ExecOptionsWithStringEncoding): Promise<{ stdout: string, stderr: string }>;
export async function execAsync(command: string, opts?: ExecOptionsWithBufferEncoding): Promise<{stdout: Buffer, stderr: Buffer }>;
export async function execAsync(command: string, opts?: ExecOptions): Promise<{stdout: string | Buffer, stderr: string | Buffer }> {
  return new Promise((resolve, reject) => {
    exec(command, opts, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export const wait = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const ellipsis = (str: string, length: number, suffix: string = '...'): string => {
  return str.length > length ? str.substring(0, length) + suffix : str;
};

// AddressInfo
// string | AddressInfo
//
export const addressInfoToString = (info: string | AddressInfo): string => {
  if (typeof info === 'string') {
    return info;
  }
  return `${info.address}:${info.port}`;
};

export const pick = <T extends {}, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> => {
  return keys.reduce((acc, key) => {
    if (key in obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      acc[key] = obj[key];
    }
    return acc;
  }, Object.create(null) as Pick<T, K>);
};
