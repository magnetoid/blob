/** Transactional email. MailHog catches everything in dev (http://localhost:8025). */

import nodemailer from 'nodemailer';
import { config } from '../config.ts';

const transport = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS ?? '' } : undefined,
});

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  await transport.sendMail({
    from: config.MAIL_FROM,
    to,
    subject,
    text,
    html: html ?? `<pre style="font:14px system-ui">${escapeHtml(text)}</pre>`,
  });
}

export async function sendInvite(to: string, inviterName: string, url: string, workspace: string) {
  await sendMail(
    to,
    `${inviterName} invited you to ${workspace}`,
    `${inviterName} invited you to join ${workspace}.\n\nAccept the invitation:\n${url}\n\nThe link expires in a few days.`,
  );
}

export async function sendPasswordReset(to: string, url: string) {
  await sendMail(
    to,
    'Reset your password',
    `Use this link to choose a new password:\n${url}\n\nIt expires in one hour. If you didn't ask for this, nothing has changed and you can ignore this email.`,
  );
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
