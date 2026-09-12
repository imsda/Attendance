import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGooglePrivateKey, parseSpreadsheetId } from '../src/services/googleSheetsService.js';

test('accepts a full Google Sheets URL or a spreadsheet ID', () => {
  const id = '1AbC_def-GHI234';
  assert.equal(parseSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(parseSpreadsheetId(id), id);
});

test('normalizes escaped Google service-account private keys', () => {
  const escaped = '"-----BEGIN PRIVATE KEY-----\\\\nABC\\\\n-----END PRIVATE KEY-----\\\\n"';
  assert.equal(normalizeGooglePrivateKey(escaped), '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----');
});

test('a normalized private key survives base64 transport', () => {
  const key = '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----';
  const encoded = Buffer.from(key, 'utf8').toString('base64');
  assert.equal(normalizeGooglePrivateKey(Buffer.from(encoded, 'base64').toString('utf8')), key);
});
