
export const withTimeout = <T>(fn: () => Promise<T>, ms: number): Promise<T> => {
  return new Promise((resolve, reject) => {
    fn().then(resolve, reject)
      .finally(() => clearTimeout(timer));
    const timer = setTimeout(() => {
      reject(new Error('Timeout'));
    }, ms);
  });
};
