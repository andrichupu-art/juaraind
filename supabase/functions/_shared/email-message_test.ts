import { getMessageParts, isWithinAttachmentLimits, type MessageStructure } from './email-message.ts';

Deno.test('selects the HTML body and keeps attachment and inline-image parts separate', () => {
  const structure: MessageStructure = {
    part: '1',
    type: 'multipart/mixed',
    childNodes: [
      {
        part: '1',
        type: 'multipart/alternative',
        childNodes: [
          { part: '1.1', type: 'text/plain', size: 25 },
          { part: '1.2', type: 'text/html', size: 80 },
        ],
      },
      {
        part: '2',
        type: 'image/png',
        id: '<logo@example.com>',
        disposition: 'inline',
        size: 128,
      },
      {
        part: '3',
        type: 'application/pdf',
        disposition: 'attachment',
        dispositionParameters: { filename: 'large.pdf' },
        size: 4 * 1024 * 1024,
      },
    ],
  };

  const parts = getMessageParts(structure);

  if (parts.body?.part !== '1.2') throw new Error('Expected the HTML alternative.');
  if (parts.attachments.length !== 2) throw new Error('Expected both attachment parts.');
  if (parts.relatedImages[0]?.part !== '2') throw new Error('Expected inline image metadata.');
});

Deno.test('prefers the HTML body over a plain-text report and ignores forwarded messages', () => {
  const structure: MessageStructure = {
    part: '1',
    type: 'multipart/mixed',
    childNodes: [
      {
        part: '1',
        type: 'multipart/alternative',
        childNodes: [
          { part: '1.1', type: 'text/plain', size: 25 },
          { part: '1.2', type: 'text/html', size: 80 },
        ],
      },
      { part: '2', type: 'text/html', size: 20 },
      {
        part: '3',
        type: 'message/rfc822',
        childNodes: [
          { part: '3.1', type: 'text/html', size: 10 },
        ],
      },
    ],
  };

  const parts = getMessageParts(structure);

  if (parts.body?.part !== '2') {
    throw new Error('Expected the HTML body instead of the earlier plain-text report.');
  }
});

Deno.test('uses the original message body from multipart reports', () => {
  const structure: MessageStructure = {
    part: '1',
    type: 'multipart/report',
    childNodes: [
      { part: '1.1', type: 'text/plain', size: 400 },
      { part: '1.2', type: 'message/delivery-status' },
      {
        part: '1.3',
        type: 'message/rfc822',
        childNodes: [
          {
            part: '1.3',
            type: 'multipart/alternative',
            childNodes: [
              { part: '1.3.1', type: 'text/plain', size: 40 },
              { part: '1.3.2', type: 'text/html', size: 120 },
            ],
          },
        ],
      },
    ],
  };

  const parts = getMessageParts(structure);

  if (parts.body?.part !== '1.3.2') {
    throw new Error('Expected the original HTML message body, not the report text.');
  }
});

Deno.test('limits attachment downloads per part and per message', () => {
  if (!isWithinAttachmentLimits(1024, 1024)) throw new Error('Small attachment should be downloadable.');
  if (isWithinAttachmentLimits(25 * 1024 * 1024 + 1, 0)) throw new Error('Oversized attachment should be skipped.');
  if (!isWithinAttachmentLimits(25 * 1024 * 1024, 0)) throw new Error('Direct downloads should use the per-file limit.');
  if (isWithinAttachmentLimits(1024, 3 * 1024 * 1024, 3 * 1024 * 1024)) {
    throw new Error('The cumulative inline-image limit should be enforced.');
  }
  if (isWithinAttachmentLimits(undefined, 0)) throw new Error('Unknown attachment sizes should not be downloaded.');
});
