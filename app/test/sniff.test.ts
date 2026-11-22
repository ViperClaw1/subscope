import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAX_BYTES, sniff, tooLarge } from '../src/files/sniff';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, '../../mobile-engineer-kit/fixtures', name)));
const text = (s: string) => new TextEncoder().encode(s);

describe('sniff mirrors the server format() rule', () => {
  it('accepts the kit fixtures', () => {
    expect(sniff(fixture('statement.csv'))).toBe('csv');
    expect(sniff(fixture('statement.pdf'))).toBe('pdf');
  });

  it('rejects spoofed.pdf (text pretending to be PDF)', () => {
    expect(sniff(fixture('spoofed.pdf'))).toBeNull();
  });

  it('works on just the 24-byte head the app reads', () => {
    expect(sniff(fixture('statement.csv').subarray(0, 24))).toBe('csv');
    expect(sniff(fixture('statement.pdf').subarray(0, 24))).toBe('pdf');
  });

  it('rejects CRLF and BOM CSVs, as the server does', () => {
    expect(sniff(text('date,description,amount\r\n2026-09-01,x,-1\r\n'))).toBeNull();
    expect(sniff(text('﻿date,description,amount\n'))).toBeNull();
  });

  it('rejects empty, short and wrong-header input', () => {
    expect(sniff(new Uint8Array())).toBeNull();
    expect(sniff(text('%PDF'))).toBeNull();
    expect(sniff(text('date,description,amount'))).toBeNull(); // no newline
    expect(sniff(text('Date,description,amount\n'))).toBeNull();
  });
});

describe('size limit', () => {
  it('allows exactly 10 MiB and rejects one byte more', () => {
    expect(tooLarge(MAX_BYTES)).toBe(false);
    expect(tooLarge(MAX_BYTES + 1)).toBe(true);
  });

  it('oversize.csv passes sniff but fails size (built in memory, kit tree untouched)', () => {
    // same construction as mobile-engineer-kit/make-oversize.mjs
    const header = 'date,description,amount\n';
    const row = '2026-09-01,Synthetic,-1.00\n';
    const rows = Math.ceil((MAX_BYTES + 1 - header.length) / row.length);
    const size = header.length + rows * row.length;
    expect(sniff(text(header + row))).toBe('csv');
    expect(tooLarge(size)).toBe(true);
  });
});
