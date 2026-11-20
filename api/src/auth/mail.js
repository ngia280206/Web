import nodemailer from 'nodemailer';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createMailer(env = process.env) {
  const mode = env.MAIL_MODE || (env.NODE_ENV === 'production' ? 'smtp' : 'file');
  if (!['file', 'smtp'].includes(mode)) throw new Error('MAIL_MODE must be file or smtp');
  if (env.NODE_ENV === 'production' && mode !== 'smtp') throw new Error('Production requires SMTP mail delivery');
  if (mode === 'smtp' && !env.SMTP_HOST) throw new Error('Configure SMTP_HOST before starting SMTP mail delivery');
  if (mode === 'smtp' && (!env.SMTP_USER?.trim() || !env.SMTP_PASS?.trim())) throw new Error('Configure SMTP_USER and SMTP_PASS before starting SMTP mail delivery');
  const gmail = env.SMTP_HOST?.trim().toLowerCase() === 'smtp.gmail.com';
  const password = gmail ? env.SMTP_PASS?.replace(/\s/g, '') : env.SMTP_PASS;
  const from = env.MAIL_FROM?.trim();
  const sender = !from || (gmail && from.includes('@bepnha.local')) ? `Bếp Nhà <${env.SMTP_USER}>` : from;
  const transport = mode === 'smtp' ? nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true',
    requireTLS: env.SMTP_SECURE !== 'true',
    auth: { user: env.SMTP_USER.trim(), pass: password },
    connectionTimeout: 10000, socketTimeout: 15000,
  }) : null;
  const send = async function (message) {
    const mail = { from: mode === 'smtp' ? sender : from || 'Bếp Nhà <no-reply@bepnha.local>', ...message };
    if (transport) { await transport.sendMail(mail); return; }
    // Local mail is intentionally outside public web roots and is never logged/returned by API.
    const directory = resolve(env.MAIL_OUTBOX_DIR || './data/mail-outbox');
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `${Date.now()}-${randomUUID()}.json`), JSON.stringify(mail, null, 2), { mode: 0o600 });
  };
  send.verify = async () => { if (!transport) throw new Error('SMTP is not enabled'); await transport.verify(); };
  return send;
}
