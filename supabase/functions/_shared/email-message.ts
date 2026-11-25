export const MAX_EMAIL_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export type MessageStructure = {
  part: string;
  type: string;
  encoding?: string;
  parameters?: Record<string, string>;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  id?: string;
  size?: number;
  childNodes?: MessageStructure[];
};

export type MessagePartInfo = {
  body?: MessageStructure;
  attachments: MessageStructure[];
  relatedImages: MessageStructure[];
};

export function partFilename(part: MessageStructure): string | undefined {
  return part.dispositionParameters?.filename || part.parameters?.name;
}

function isAttachment(part: MessageStructure): boolean {
  return part.disposition?.toLowerCase() === 'attachment' ||
    !!partFilename(part) ||
    (!!part.id && part.type.toLowerCase().startsWith('image/'));
}

export function getMessageParts(structure: MessageStructure): MessagePartInfo {
  const attachments: MessageStructure[] = [];
  const relatedImages: MessageStructure[] = [];

  function isEmbeddedMessage(part: MessageStructure): boolean {
    return part.type.toLowerCase() === 'message/rfc822';
  }

  function findBody(part: MessageStructure): MessageStructure[] {
    if (isAttachment(part) || isEmbeddedMessage(part)) return [];

    if (part.childNodes?.length) {
      const children = part.childNodes.filter((child) =>
        !isAttachment(child) && !isEmbeddedMessage(child)
      );
      const type = part.type.toLowerCase();

      if (type === 'multipart/related') {
        const start = part.parameters?.start?.replace(/^<|>$/g, '').toLowerCase();
        const root = start
          ? children.find((child) => child.id?.replace(/^<|>$/g, '').toLowerCase() === start)
          : undefined;
        const bodyRoot = root ?? children[0];
        return bodyRoot ? findBody(bodyRoot) : [];
      }

      return children.flatMap(findBody);
    }

    const type = part.type.toLowerCase();
    return (type === 'text/html' || type === 'text/plain') &&
        (part.size === undefined || part.size <= MAX_EMAIL_BODY_BYTES)
      ? [part]
      : [];
  }

  function collectAttachments(part: MessageStructure) {
    if (isEmbeddedMessage(part)) return;
    if (isAttachment(part)) {
      attachments.push(part);
      if (part.id && part.type.toLowerCase().startsWith('image/')) relatedImages.push(part);
      return;
    }
    part.childNodes?.forEach(collectAttachments);
  }

  collectAttachments(structure);
  const body = findBody(structure).sort((a, b) => {
    const typeOrder = (candidate: MessageStructure) =>
      candidate.type.toLowerCase() === 'text/html' ? 0 : 1;
    const sizeOrder = (candidate: MessageStructure) =>
      candidate.size ?? Number.MAX_SAFE_INTEGER;
    return typeOrder(a) - typeOrder(b) || sizeOrder(a) - sizeOrder(b);
  })[0];

  return { body, attachments, relatedImages };
}

export function isWithinAttachmentLimits(
  size: number | undefined,
  capturedBytes: number,
  maxTotalBytes = MAX_ATTACHMENT_BYTES,
): boolean {
  return Number.isFinite(size) &&
    (size as number) <= MAX_ATTACHMENT_BYTES &&
    capturedBytes + (size as number) <= maxTotalBytes;
}
