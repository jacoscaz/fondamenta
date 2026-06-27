#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

interface Options {
  help: boolean;
  dir: string;
  exclude: string[];
  extensions: string[];
  'max-size': string;
  output?: string;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    help: false,
    dir: '.',
    exclude: [],
    extensions: [],
    'max-size': '1048576', // 1MB default
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '-d':
      case '--dir':
        options.dir = args[++i];
        break;
      case '-e':
      case '--exclude':
        options.exclude = args[++i].split(',').map(s => s.trim()).filter(Boolean);
        break;
      case '-x':
      case '--extensions':
        options.extensions = args[++i].split(',').map(s => s.trim().replace(/^\./, '')).filter(Boolean);
        break;
      case '-s':
      case '--max-size':
        options['max-size'] = args[++i];
        break;
      case '-o':
      case '--output':
        options.output = args[++i];
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        break;
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`dir2bundle: Pack files into a single concatenated output

Usage:
  dir2bundle [options]

Required:
  -x, --extensions EXT   Comma-separated extensions to include

Options:
  -d, --dir DIR          Directory to pack (default: .)
  -e, --exclude PATTERN  Comma-separated exclude patterns (default: node_modules,.git)
  -s, --max-size BYTES   Maximum file size to include (default: 1048576)
  -o, --output FILE      Output to file instead of stdout
  -h, --help              Show this help message

Examples:
  dir2bundle --dir ./src --extensions ts,js
  dir2bundle --dir . --exclude node_modules,dist --extensions py,md
  dir2bundle -d ./my-project -x ts,tsx,json -o ./packed.txt | head -n 100
`);
}

function shouldExclude(filePath: string, excludePatterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return excludePatterns.some(pattern => {
    // Check if path contains the pattern anywhere
    if (normalizedPath.includes(`/${pattern}/`)) return true;
    if (normalizedPath.includes(`/${pattern}`)) return true;
    // Check exact match for filenames
    const basename = path.basename(normalizedPath);
    return basename === pattern;
  });
}

function hasAllowedExtension(filePath: string, extensions: string[]): boolean {
  if (extensions.length === 0) return true;
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return extensions.includes(ext);
}

function packDirectory(dir: string, options: Options): string {
  const files: Array<{ relPath: string; content: string }> = [];
  const exclude = [...options.exclude, 'node_modules', '.git', '.vscode', '.idea'];
  const maxSize = parseInt(options['max-size'], 10);

  function walk(currentPath: string): void {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relPath = path.relative(dir, fullPath);

        if (shouldExclude(fullPath, exclude)) {
          continue;
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          if (!hasAllowedExtension(fullPath, options.extensions)) {
            continue;
          }

          try {
            const stats = fs.statSync(fullPath);
            if (stats.size > maxSize) {
              continue;
            }

            const content = fs.readFileSync(fullPath, 'utf-8');
            files.push({ relPath, content });
          } catch {
            // Skip files we can't read
            continue;
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  walk(dir);

  // Sort files for deterministic output
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));

  const output: string[] = [];
  for (const file of files) {
    output.push(`### FILE: ${file.relPath} ###`);
    output.push(file.content);
    output.push(''); // Empty line for separation
  }

  return output.join('\n');
}

function main(): void {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (!options.extensions || options.extensions.length === 0) {
    showHelp();
    process.exit(0);
  }

  const dir = path.resolve(options.dir);

  if (!fs.existsSync(dir)) {
    console.error(`Error: Directory not found: ${dir}`);
    process.exit(1);
  }

  if (!fs.statSync(dir).isDirectory()) {
    console.error(`Error: Path is not a directory: ${dir}`);
    process.exit(1);
  }

  const result = packDirectory(dir, options);

  if (options.output) {
    fs.writeFileSync(path.resolve(options.output), result, 'utf-8');
    console.log(`Packed ${dir} -> ${options.output}`);
  } else {
    console.log(result);
  }
}

main();
