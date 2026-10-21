/** Admin → Security (M3 · C3): where this workspace stands — and, for whoever runs the
 *  server, where the server does — read live each time the page opens. */

import { api, type SecurityCheck } from '../../../lib/api.ts';
import { navigate } from '../../../lib/router.ts';
import { showError } from '../../../lib/toasts.ts';
import { useFetch } from '../../../lib/useFetch.ts';
import { Card, CardNotice } from '../../console/Card.tsx';

const SAYS: Record<SecurityCheck['state'], string> = {
  ok: 'Good',
  attention: 'Worth a look',
  info: 'A choice',
};

/** Where each of the workspace's checks is changed. The server's are its environment's,
 *  so they link nowhere. */
const WHERE: Record<string, string> = {
  admins_two_step: '/admin/members',
  agents_ask: '/admin/apps',
  agents_write: '/admin/apps',
  assistants: '/admin/connections',
  history: '/admin/retention',
  audit: '/admin/audit',
};

function Title({ check }: { check: SecurityCheck }) {
  const path = WHERE[check.id];
  if (!path) return <span className="pref-label">{check.title}</span>;
  return (
    <a
      className="pref-label security-link"
      href={path}
      onClick={(event) => {
        // A modified click is somebody asking for a tab; a plain one stays in the console.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(path);
      }}
    >
      {check.title}
    </a>
  );
}

function Checks({
  title,
  description,
  checks,
}: {
  title: string;
  description: string;
  checks: SecurityCheck[];
}) {
  return (
    <Card title={title} description={description}>
      <ul className="hold-list" aria-label={title}>
        {checks.map((check) => (
          <li key={check.id} className="hold-row security-check" data-state={check.state}>
            <span className="grow">
              <Title check={check} />
              <span className="pref-hint block">{check.detail}</span>
            </span>
            <span className="role-pill" data-muted={check.state === 'info' ? '' : undefined}>
              {SAYS[check.state]}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SecuritySection() {
  const { data } = useFetch(() => api.admin.security(), [], { onError: showError });
  if (!data) {
    return (
      <div className="console-stack">
        <Card>
          <CardNotice>Loading…</CardNotice>
        </Card>
      </div>
    );
  }
  return (
    <div className="console-stack">
      <Checks
        title="This workspace"
        description="How people and agents here sign in and act, and how long what they write is kept."
        checks={data.workspace}
      />
      {data.server && (
        <Checks
          title="This server"
          description="How it was deployed — set in its environment, by whoever runs it."
          checks={data.server}
        />
      )}
    </div>
  );
}
