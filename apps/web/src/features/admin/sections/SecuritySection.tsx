/** Admin → Security (M3 · C3): where this workspace stands — and, for whoever runs the
 *  server, where the server does — read live each time the page opens. */

import { api, type SecurityCheck } from '../../../lib/api.ts';
import { navigate } from '../../../lib/router.ts';
import { showError } from '../../../lib/toasts.ts';
import { useFetch } from '../../../lib/useFetch.ts';
import { Badge } from '../../../components/ui/badge.tsx';
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from '../../../components/ui/item.tsx';
import { Card, CardNotice, CardRow, CardRows } from '../../console/Card.tsx';

const SAYS: Record<SecurityCheck['state'], string> = {
  ok: 'Good',
  attention: 'Worth a look',
  info: 'A choice',
};

/** A check that is worth a look is said in the signal colour; the rest are quiet. */
const BADGE = { ok: 'secondary', attention: 'destructive', info: 'outline' } as const;

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
  if (!path) return <>{check.title}</>;
  return (
    <a
      className="rounded-xs underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
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
      <CardRows aria-label={title}>
        {checks.map((check) => (
          <CardRow key={check.id} data-state={check.state}>
            <ItemContent>
              <ItemTitle>
                <Title check={check} />
              </ItemTitle>
              <ItemDescription>{check.detail}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant={BADGE[check.state]}>{SAYS[check.state]}</Badge>
            </ItemActions>
          </CardRow>
        ))}
      </CardRows>
    </Card>
  );
}

export function SecuritySection() {
  const { data } = useFetch(() => api.admin.security(), [], { onError: showError });
  if (!data) {
    return (
      <div className="flex flex-col gap-6">
        <Card>
          <CardNotice>Loading…</CardNotice>
        </Card>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
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
