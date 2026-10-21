/**
 * The contract (README: "the client is the contract"), run as one person and then two
 * against a server that has just been booted from the production image.
 *
 * It founds the workspace through the first-run form, invites a second person by link,
 * and then exercises what every day of Blob rests on, each from one side and seen on the
 * other: a message arriving live, a thread reply, a reaction, search, and a file that goes
 * up to storage and comes back down. Every step is the real client against the real
 * server, database, Redis and object storage — nothing is stubbed.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'a-long-password-for-the-contract';
const OWNER = { name: 'Olga Owner', email: 'olga@contract.example' };
const MEMBER = { name: 'Max Member', email: 'max@contract.example' };

/** Uncaught errors from every page, checked at the end of each test: a script error the
 *  user never sees is still a broken page. */
const pageErrors: string[] = [];

async function newPerson(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${page.url()}: ${error.message}`));
  return page;
}

async function signUp(page: Page, person: { name: string; email: string }) {
  await page.getByLabel('Display name').fill(person.name);
  await page.getByLabel('Email').fill(person.email);
  await page.locator('#auth-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('main.pane')).toBeVisible();
}

async function channelId(page: Page, name: string): Promise<string> {
  const response = await page.request.get('/api/channels');
  expect(response.ok()).toBe(true);
  const { channels } = (await response.json()) as { channels: { id: string; name: string }[] };
  const found = channels.find((channel) => channel.name === name);
  expect(found, `#${name} exists`).toBeTruthy();
  return found!.id;
}

function message(page: Page, text: string) {
  return page.locator('article.message').filter({ hasText: text }).first();
}

// The second test signs in to what the first founded.
test.describe.configure({ mode: 'serial' });

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test('two people, one conversation, every part of it', async ({ browser }) => {
  // ── The first person founds the workspace ───────────────────────────────────
  const olga = await newPerson(browser);
  await olga.goto('/');
  await olga.getByLabel('Workspace name').fill('Contract Inc');
  await signUp(olga, OWNER);

  // ── …and invites a second by link ───────────────────────────────────────────
  await olga.goto('/admin/invitations');
  await olga.getByRole('button', { name: 'Create invitation' }).click();
  const link = (await olga.locator('.console-copy .ellipsis').first().innerText()).trim();
  expect(link).toMatch(/\/join\//);

  const max = await newPerson(browser);
  await max.goto(link);
  await signUp(max, MEMBER);

  const general = await channelId(olga, 'general');
  await Promise.all([olga.goto(`/c/${general}`), max.goto(`/c/${general}`)]);
  const olgaBox = olga.getByRole('textbox', { name: /Message #general/ });
  const maxBox = max.getByRole('textbox', { name: /Message #general/ });
  await expect(olgaBox).toBeVisible();
  await expect(maxBox).toBeVisible();

  // ── A message arrives on the other side without a reload ────────────────────
  const hello = `Hello from the contract ${Date.now()}`;
  await olgaBox.fill(hello);
  await olgaBox.press('Enter');
  await expect(message(max, hello)).toBeVisible();

  // ── A reply in its thread ───────────────────────────────────────────────────
  await message(max, hello).hover();
  await message(max, hello).getByRole('button', { name: 'Reply in thread' }).click();
  const threadBox = max.getByPlaceholder('Reply in thread');
  await threadBox.fill('Replying in the thread');
  await threadBox.press('Enter');
  await expect(message(olga, hello).getByText(/1 reply/)).toBeVisible();

  // ── A reaction ──────────────────────────────────────────────────────────────
  await message(olga, hello).hover();
  await message(olga, hello).getByRole('button', { name: 'Add reaction' }).click();
  const picker = olga.getByRole('dialog').filter({ has: olga.getByLabel('Search emoji') });
  await picker.getByLabel('Search emoji').fill('tada');
  await picker.getByRole('button').filter({ hasText: '🎉' }).first().click();
  await expect(message(max, hello).getByRole('button', { name: /🎉/ })).toBeVisible();

  // ── Search finds it ─────────────────────────────────────────────────────────
  await max.goto(`/search?q=${encodeURIComponent('contract')}`);
  await expect(max.locator('.search-results').getByText(hello)).toBeVisible();

  // ── A file goes up to storage and comes back down ───────────────────────────
  await max.goto(`/c/${general}`);
  const body = `contract file ${Date.now()}`;
  await max.locator('input[type=file][name=attachment]').setInputFiles({
    name: 'contract-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(body),
  });
  // Up to storage first: the composer will not send a file that is still uploading.
  await expect(max.locator('.attachment-chip[data-status="ready"]')).toBeVisible();
  await maxBox.fill('The notes are attached');
  await maxBox.press('Enter');
  const filed = message(olga, 'The notes are attached');
  await expect(filed.getByText('contract-notes.txt')).toBeVisible();
  const href = await filed.getByRole('link', { name: 'Download contract-notes.txt' }).getAttribute('href');
  expect(href).toBeTruthy();
  const download = await olga.request.get(href!);
  expect(download.ok()).toBe(true);
  expect(await download.text()).toBe(body);
});

/** Pages a person reaches every day, and the admin pages people configure the server on. */
const PAGES = [
  '/',
  '/c/{general}',
  '/activity',
  '/threads',
  '/later',
  '/drafts',
  '/files',
  '/search?q=contract',
  '/help',
  '/settings/preferences',
  '/admin/general',
  '/admin/people',
  '/admin/channels',
  '/admin/retention',
  '/admin/export',
  '/admin/audit',
];

test('every page passes axe', async ({ browser }) => {
  const olga = await newPerson(browser);
  await olga.goto('/');
  await olga.getByLabel('Email').fill(OWNER.email);
  await olga.locator('#auth-password').fill(PASSWORD);
  await olga.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(olga.locator('main.pane')).toBeVisible();
  const general = await channelId(olga, 'general');

  const failures: string[] = [];
  for (const path of PAGES) {
    await olga.goto(path.replace('{general}', general));
    await expect(olga.locator('main.pane, .admin-main').first()).toBeVisible();
    // Let entrances finish: axe reads colours, and a fading element is half its contrast.
    await olga.waitForTimeout(400);
    const { violations } = await new AxeBuilder({ page: olga })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    for (const v of violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')) {
      failures.push(
        `${path} — ${v.id} (${v.impact}): ${v.help}\n    ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join('\n    ')}`,
      );
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
});
