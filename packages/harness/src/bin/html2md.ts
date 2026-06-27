#!/usr/bin/env node

import TurndownService from 'turndown';
import { errToString } from '@fondamenta/utils';

/**
 * Singleton instance of Turndown service for HTML-to-Markdown conversion
 */
const turndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
});

// Strip elements that produce noise in markdown output.
// Turndown's default behavior dumps their text content as-is,
// which floods the output with JS code, CSS rules, and SVG markup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
turndownService.remove(['script', 'style', 'noscript', 'svg', 'iframe'] as any);

let stdin = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk: string) => {
  stdin += chunk;
});

process.stdin.on('end', () => {
  if (!stdin) {
    console.log('--- empty ---');
    return;
  }
  try {
    console.log(turndownService.turndown(stdin));
  } catch (error) {
    throw new Error(`Failed to convert HTML to Markdown: ${errToString(error)}`);
  }
});
