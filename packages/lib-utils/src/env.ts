

export const getEnvVar = (name: string, optional?: boolean): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return value;
};

export const fillEnvVarsPlaceholders = <O extends {}>(obj: O, env: Record<string, string | undefined>, path_prefix: string = '') => {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = obj[key];
      const path = path_prefix.length > 0 ? `${path_prefix}.${key}` : key;
      if (typeof val === 'string' && val.startsWith('${') && val.endsWith('}')) {
        const rep = env[val.slice(2, -1)];
        if (typeof rep !== 'string' || rep.length === 0) {
          throw new Error(`Missing environment variable ${val.slice(2, -1)} at path ${path}`);
        }
        obj[key] = rep as O[typeof key];
      } else if (typeof (obj[key]) == 'object' && obj[key] !== null) {
        fillEnvVarsPlaceholders(obj[key], env, path);
      }
    }
  }
};
