/** The Backups tile on the Health page (M3 · B4): what an admin is told, and when it is red. */
import { describe, expect, it } from 'vitest';
import { backupTile } from './model.ts';

const NOW = Date.parse('2026-10-21T10:00:00.000Z');
const base = { enabled: true, at: null, ok: null, bytes: null, error: null };

describe('the Backups tile', () => {
  it('is red when nothing is backing up', () => {
    expect(backupTile(undefined, NOW).bad).toBe(true);
    expect(backupTile({ ...base, enabled: false }, NOW)).toMatchObject({ value: 'Off', bad: true });
  });

  it('waits calmly for the first night', () => {
    expect(backupTile(base, NOW)).toEqual({
      value: 'None yet',
      bad: false,
      hint: 'The first one runs tonight.',
    });
  });

  it('says why the last one failed', () => {
    const failed = { ...base, at: '2026-10-21T03:30:00Z', ok: false, error: 'connection refused' };
    expect(backupTile(failed, NOW)).toEqual({ value: 'Failing', bad: true, hint: 'connection refused' });
  });

  it('gives the size and the age of a good one', () => {
    const good = { ...base, at: '2026-10-21T03:30:00Z', ok: true, bytes: 12 * 1024 * 1024 };
    expect(backupTile(good, NOW)).toEqual({ value: '12.0 MB, 7 hours ago', bad: false });
  });

  it('turns red when a night was missed', () => {
    const stale = { ...base, at: '2026-10-19T03:30:00Z', ok: true, bytes: 2048 };
    expect(backupTile(stale, NOW)).toMatchObject({ bad: true, hint: 'No backup in more than a day.' });
  });
});
