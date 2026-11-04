import { parseEmailStream } from './email-message.ts';

Deno.test('streams message headers, body, and small attachments', async () => {
  const raw = [
    'From: Ada <ada@example.com>',
    'To: Bob <bob@example.com>',
    'Subject: Streamed message',
    'Date: Tue, 4 Nov 2026 10:00:00 +0000',
    'Message-ID: <message@example.com>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary=mail-boundary',
    '',
    '--mail-boundary',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Hello <img src="cid:image@example.com"></p>',
    '--mail-boundary',
    'Content-Type: image/png; name=small.png',
    'Content-Disposition: inline; filename=small.png',
    'Content-ID: <image@example.com>',
    'Content-Transfer-Encoding: base64',
    '',
    'AQIDBA==',
    '--mail-boundary--',
    '',
  ].join('\r\n');

  const parsed = await parseEmailStream([new TextEncoder().encode(raw)]);
  const attachment = parsed.attachments[0];

  if (parsed.subject !== 'Streamed message') throw new Error('Subject was not parsed.');
  if (parsed.from_email !== 'ada@example.com') throw new Error('Sender address was not parsed.');
  if (parsed.to !== '"Bob" <bob@example.com>') throw new Error('Recipient was not parsed.');
  if (parsed.message_id !== '<message@example.com>') throw new Error('Message ID was not parsed.');
  if (!parsed.html?.includes('cid:image@example.com')) throw new Error('HTML body was not parsed.');
  if (attachment?.cid !== 'image@example.com') throw new Error('Attachment content ID was not parsed.');
  if (attachment.content?.toString('base64') !== 'AQIDBA==') throw new Error('Small attachment content was not retained.');
});

Deno.test('continues parsing the message without retaining oversized attachments', async () => {
  const attachment = btoa('x'.repeat(1024 * 1024 + 1));
  const raw = [
    'From: Ada <ada@example.com>',
    'Subject: Large attachment',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary=large-boundary',
    '',
    '--large-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Body remains readable.',
    '--large-boundary',
    'Content-Type: application/octet-stream; name=large.bin',
    'Content-Disposition: attachment; filename=large.bin',
    'Content-Transfer-Encoding: base64',
    '',
    attachment,
    '--large-boundary--',
    '',
  ].join('\r\n');

  const parsed = await parseEmailStream([new TextEncoder().encode(raw)]);
  const parsedAttachment = parsed.attachments[0];

  if (parsed.text !== 'Body remains readable.') throw new Error('Message body was not parsed.');
  if (parsed.attachments.length !== 1) throw new Error('Attachment metadata was not retained.');
  if (!parsedAttachment) throw new Error('Attachment metadata was not retained.');
  if (parsedAttachment.content) throw new Error('Oversized attachment content should not be retained.');
  if ((parsedAttachment.size || 0) <= 1024 * 1024) throw new Error('Attachment size was not measured.');
});
