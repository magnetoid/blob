import { describe, expect, it } from 'vitest';
import { SERVER_SECTIONS } from '../../lib/router.ts';
import { SERVER_ACCESS, canOpen, serverLanding, type Viewer } from './access.ts';

const MEMBER: Viewer = { role: 'member', isInstanceAdmin: false };
const ADMIN: Viewer = { role: 'admin', isInstanceAdmin: false };
const FOUNDER: Viewer = { role: 'owner', isInstanceAdmin: true };
/** Runs the server, and is a plain member of the workspace they are signed into. */
const MEMBER_WHO_RUNS_IT: Viewer = { role: 'member', isInstanceAdmin: true };

describe('where the server console opens', () => {
  it('on Health for anybody who may read it', () => {
    expect(serverLanding(FOUNDER)).toBe('/server/health');
    expect(serverLanding(ADMIN)).toBe('/server/health');
  });

  // The account menu offers "Server" to the server's administrator whatever their role
  // here; sent to Health, a member among them was bounced straight back out.
  it('on the first page that is theirs, for a server admin who is a member here', () => {
    const landing = serverLanding(MEMBER_WHO_RUNS_IT);
    expect(landing).toBe('/server/users');
    expect(canOpen(SERVER_ACCESS.users, MEMBER_WHO_RUNS_IT)).toBe(true);
    expect(canOpen(SERVER_ACCESS.health, MEMBER_WHO_RUNS_IT)).toBe(false);
  });

  it('nowhere for a member', () => {
    expect(serverLanding(MEMBER)).toBeNull();
    for (const section of SERVER_SECTIONS) {
      expect(canOpen(SERVER_ACCESS[section], MEMBER)).toBe(false);
    }
  });
});
