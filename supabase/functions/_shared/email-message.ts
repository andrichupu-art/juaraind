export const MAX_EMAIL_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export type MessageStructure = {
  part: string;
  type: string;
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
  const textParts: MessageStructure[] = [];
  const attachments: MessageStructure[] = [];
  const relatedImages: MessageStructure[] = [];

  function visit(part: MessageStructure) {
    if (part.childNodes?.length) {
      part.childNodes.forEach(visit);
      return;
    }

    if (isAttachment(part)) {
      attachments.push(part);
      if (part.id && part.type.toLowerCase().startsWith('image/')) relatedImages.push(part);
      return;
    }

    if (part.type.toLowerCase() === 'text/html' || part.type.toLowerCase() === 'text/plain') {
      textParts.push(part);
    }
  }

  visit(structure);
  const bodyCandidates = textParts.filter((part) => part.size === undefined || part.size <= MAX_EMAIL_BODY_BYTES);
  bodyCandidates.sort((a, b) => {
    const typeOrder = (part: MessageStructure) => part.type.toLowerCase() === 'text/html' ? 0 : 1;
    const sizeOrder = (part: MessageStructure) => part.size ?? Number.MAX_SAFE_INTEGER;
    return typeOrder(a) - typeOrder(b) || sizeOrder(a) - sizeOrder(b);
  });

  return { body: bodyCandidates[0], attachments, relatedImages };
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
