export const nonSafeRandom = (len: number): string => {
  return Math.round(Math.random() * Math.pow(10, len * 2)).toString(36).slice(0, len);
};
