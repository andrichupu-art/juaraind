import { MailParser } from 'npm:mailparser@3.7.1';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Bound attachment data returned by one read request to stay within worker memory limits.
const MAX_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export type ParsedAttachment = {
  cid?: string;
  content?: Buffer;
  contentType?: string;
  filename?: string;
  size?: number;
};

export type ParsedEmailMessage = {
  subject: string;
  from: string;
  from_email: string;
  to: string;
  date: Date | null;
  html: string | null;
  text: string;
  message_id: string;
  attachments: ParsedAttachment[];
};

type MessageHeaders = { get(name: string): unknown };
type MessagePart =
  | { type: 'text'; text?: string; html?: string | false }
  | {
    type: 'attachment';
    content: AsyncIterable<Uint8Array>;
    contentId?: string;
    contentType?: string;
    filename?: string;
    release(): void;
  };

export async function parseEmailStream(
  source: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
): Promise<ParsedEmailMessage> {
  const parser = new MailParser();
  let headers: MessageHeaders | undefined;
  let text = '';
  let html: string | false = false;
  let capturedAttachmentBytes = 0;
  let attachmentError: Error | undefined;
  const attachmentJobs: Promise<void>[] = [];
  const attachments: Array<ParsedAttachment & { size: number }> = [];

  parser.on('headers', (messageHeaders: MessageHeaders) => {
    headers = messageHeaders;
  });
  parser.on('data', (part: MessagePart) => {
    if (part.type === 'text') {
      text = part.text || '';
      html = part.html || false;
      return;
    }
    if (part.type !== 'attachment') return;

    attachmentJobs.push((async () => {
      const chunks: Buffer[] = [];
      let size = 0;
      let retainContent = capturedAttachmentBytes < MAX_TOTAL_ATTACHMENT_BYTES;
      try {
        for await (const chunk of part.content) {
          size += chunk.length;
          if (
            retainContent &&
            size <= MAX_ATTACHMENT_BYTES &&
            capturedAttachmentBytes + size <= MAX_TOTAL_ATTACHMENT_BYTES
          ) {
            chunks.push(Buffer.from(chunk));
          } else {
            retainContent = false;
            chunks.length = 0;
          }
        }
        const content = retainContent ? Buffer.concat(chunks) : undefined;
        if (content) capturedAttachmentBytes += size;
        attachments.push({
          cid: part.contentId?.replace(/^<|>$/g, ''),
          content,
          contentType: part.contentType,
          filename: part.filename,
          size,
        });
      } catch (error) {
        attachmentError = error instanceof Error ? error : new Error(String(error));
        parser.destroy(attachmentError);
      } finally {
        part.release();
      }
    })());
  });

  await pipeline(Readable.from(source), parser);
  await Promise.all(attachmentJobs);
  if (attachmentError) throw attachmentError;

  const from = headers?.get('from');
  const to = headers?.get('to');
  const date = headers?.get('date');
  const messageId = headers?.get('message-id');

  const addressText = (header: unknown) =>
    typeof header === 'object' && header !== null && 'text' in header
      ? String(header.text || '')
      : '';
  const firstAddress = (header: unknown) => {
    if (typeof header !== 'object' || header === null || !('value' in header) || !Array.isArray(header.value)) {
      return '';
    }
    const address = header.value[0]?.address;
    return typeof address === 'string' ? address : '';
  };

  const subject = headers?.get('subject');
  return {
    subject: typeof subject === 'string' ? subject : '',
    from: addressText(from),
    from_email: firstAddress(from),
    to: addressText(to),
    date: date instanceof Date ? date : null,
    html: typeof html === 'string' ? html : null,
    text,
    message_id: typeof messageId === 'string' ? messageId : '',
    attachments,
  };
}
