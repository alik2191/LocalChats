export type ChannelKind = 'wa' | 'tg' | 'viber';
export type ChannelOwner = 'company' | 'personal';
export type Attribution = 'exact' | 'fallback' | 'direct';

export interface Employee {
  id: string;
  name: string;
  initials: string;
}

export interface Channel {
  id: string;
  kind: ChannelKind;
  owner: ChannelOwner;
  ownerId: string; // employee id for personal, 'company' for company channels
  displayName: string;
  externalRef: string;
  status: 'online' | 'offline';
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'in' | 'out';
  body: string;
  ts: number;
  status: 'sent' | 'delivered' | 'read';
}

export interface Click {
  clickId: string; // 8 chars, Crockford base32
  channelKind: ChannelKind;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  gclid?: string;
  ipHash: string;
  uaHash: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  channelId: string;
  personal: boolean;
  contactName: string;
  phone?: string;
  attribution?: Attribution; // undefined for personal chats
  clickId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  gclid?: string;
  unread: number;
  lastTs: number;
}
