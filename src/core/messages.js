import { normalizeUsername } from './accounts.js';

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeTimestamp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Date.now();
  if (number > 100_000_000_000_000) return Math.floor(number / 1000);
  return number < 10_000_000_000 ? number * 1000 : number;
}

export function inferMessageType(message) {
  if (message.item_type) return String(message.item_type);
  if (message.photos?.length) return 'photo';
  if (message.videos?.length) return 'video';
  if (message.audio_files?.length) return 'audio';
  if (message.gifs?.length) return 'gif';
  if (message.sticker) return 'sticker';
  if (message.share || message.media_share) return 'share';
  if (message.link) return 'link';
  if (message.call_duration != null) return 'call';
  if (message.content || message.text) return 'text';
  return 'unknown';
}

function contentFromMessage(message, type) {
  return String(
    message.content
      ?? message.text
      ?? message.link?.link_context?.link_title
      ?? message.share?.link
      ?? message.media_share?.caption?.text
      ?? `[${type}]`,
  );
}

export function parseInstagramHelperData(data, sourceName = 'InstagramHelperData.json') {
  if (!data || !Array.isArray(data.allMessagesItemsArray)) return [];
  const participants = new Map(
    (data.usersChatParticipants || []).map((participant) => [
      String(participant.pk ?? participant.id),
      participant.username ?? participant.full_name ?? String(participant.pk ?? participant.id),
    ]),
  );
  const myId = String(data.myUserId ?? '');

  return data.allMessagesItemsArray.map((message, index) => {
    const type = inferMessageType(message);
    const timestamp = normalizeTimestamp(message.timestamp);
    const senderId = String(message.user_id ?? '');
    const senderName = participants.get(senderId) || senderId || 'Unknown';
    const content = contentFromMessage(message, type);
    const id = String(message.item_id ?? message.id ?? fnv1a(`${sourceName}:${senderId}:${timestamp}:${content}:${index}`));
    return {
      id,
      conversationId: String(data.threadId ?? sourceName),
      conversationName: String(data.threadTitle ?? sourceName.replace(/\.json$/i, '')),
      senderName,
      senderId,
      isMine: senderId === myId,
      timestamp,
      type,
      content,
      raw: message,
      source: 'instagram-helper',
    };
  });
}

export function parseMetaConversation(data, {
  sourceName = 'message_1.json',
  ownerNames = [],
} = {}) {
  if (!data || !Array.isArray(data.messages)) return [];
  const participants = (data.participants || []).map((participant) => participant.name).filter(Boolean);
  const conversationName = participants.join(', ') || sourceName.replace(/\.json$/i, '');
  const conversationId = String(data.thread_path ?? data.title ?? sourceName.replace(/\/message_\d+\.json$/i, ''));
  const ownerSet = new Set(ownerNames.map((name) => String(name).trim().toLowerCase()).filter(Boolean));

  return data.messages.map((message, index) => {
    const type = inferMessageType(message);
    const timestamp = normalizeTimestamp(message.timestamp_ms ?? message.timestamp);
    const senderName = String(message.sender_name ?? message.sender ?? 'Unknown');
    const content = contentFromMessage(message, type);
    const id = String(message.message_id ?? message.id ?? fnv1a(`${sourceName}:${senderName}:${timestamp}:${content}:${index}`));
    return {
      id,
      conversationId,
      conversationName,
      senderName,
      senderId: null,
      isMine: ownerSet.has(senderName.trim().toLowerCase()),
      timestamp,
      type,
      content,
      raw: message,
      source: 'meta-export',
    };
  });
}

export function dedupeMessages(messages) {
  const map = new Map();
  for (const message of messages || []) {
    if (!message?.id) continue;
    map.set(`${message.conversationId}:${message.id}`, message);
  }
  return [...map.values()].sort((a, b) => b.timestamp - a.timestamp);
}

export function filterMessages(messages, filters = {}) {
  const keyword = String(filters.keyword || '').trim().toLowerCase();
  const types = new Set(filters.types || []);
  const conversationIds = new Set(filters.conversationIds || []);
  const sender = String(filters.sender || '').trim().toLowerCase();
  const from = filters.dateFrom ? new Date(filters.dateFrom).getTime() : -Infinity;
  const to = filters.dateTo ? new Date(filters.dateTo).getTime() + 86_399_999 : Infinity;

  return (messages || []).filter((message) => {
    if (filters.onlyMine !== false && !message.isMine) return false;
    if (keyword && !`${message.content} ${message.senderName} ${message.conversationName}`.toLowerCase().includes(keyword)) return false;
    if (types.size && !types.has(message.type)) return false;
    if (conversationIds.size && !conversationIds.has(message.conversationId)) return false;
    if (sender && !message.senderName.toLowerCase().includes(sender)) return false;
    if (message.timestamp < from || message.timestamp > to) return false;
    return true;
  });
}

export function createUnsendPlan(messages, selectedIds, {
  createdAt = Date.now(),
  order = 'newest-first',
} = {}) {
  const selected = new Set(selectedIds || []);
  const eligible = (messages || [])
    .filter((message) => message.isMine && selected.has(message.id))
    .sort((a, b) => order === 'oldest-first' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp)
    .map((message) => ({
      id: message.id,
      conversationId: message.conversationId,
      conversationName: message.conversationName,
      timestamp: message.timestamp,
      type: message.type,
      preview: message.content.slice(0, 240),
      status: 'pending',
    }));

  return {
    schemaVersion: 1,
    kind: 'insta-aio-unsend-plan',
    createdAt: new Date(createdAt).toISOString(),
    total: eligible.length,
    messages: eligible,
  };
}

export function conversationSummary(messages) {
  const map = new Map();
  for (const message of messages || []) {
    const current = map.get(message.conversationId) || {
      id: message.conversationId,
      name: message.conversationName,
      count: 0,
      sentCount: 0,
      latestAt: 0,
    };
    current.count += 1;
    if (message.isMine) current.sentCount += 1;
    current.latestAt = Math.max(current.latestAt, message.timestamp);
    map.set(message.conversationId, current);
  }
  return [...map.values()].sort((a, b) => b.latestAt - a.latestAt);
}

export { normalizeUsername };
