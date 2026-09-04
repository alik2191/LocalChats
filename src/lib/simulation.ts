import type { Channel, ChannelKind, Click, Conversation, Employee, Message } from '../types';
import { genCid, hashStr } from './attribution';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export const rnd = (n: number) => Math.floor(Math.random() * n);
export const pick = <T,>(arr: T[]): T => arr[rnd(arr.length)];

const MIN = 60 * 1000;

interface SeedConv {
  channelId: string;
  name: string;
  phone?: string;
  minutesAgo: number;
  unread: number;
  attribution?: 'exact' | 'fallback' | 'direct';
  utm?: [string, string, string];
  gclid?: string;
  msgs: Array<[dir: 'in' | 'out', body: string, minutesAgo: number]>;
}

export function buildSeed(): {
  employees: Employee[];
  currentUserId: string;
  channels: Channel[];
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  clicks: Click[];
} {
  const now = Date.now();
  const employees: Employee[] = [
    { id: 'e1', name: 'Олена Коваленко', initials: 'ОК' },
    { id: 'e2', name: 'Дмитро Савчук', initials: 'ДС' },
  ];

  const channels: Channel[] = [
    { id: 'ch_wa', kind: 'wa', owner: 'company', ownerId: 'company', displayName: 'WhatsApp', externalRef: '+38 067 214 88 30', status: 'online' },
    { id: 'ch_tg', kind: 'tg', owner: 'company', ownerId: 'company', displayName: 'Telegram', externalRef: '@meridian_ua', status: 'online' },
    { id: 'ch_vb', kind: 'viber', owner: 'company', ownerId: 'company', displayName: 'Viber', externalRef: '+38 063 511 27 64', status: 'online' },
    { id: 'ch_p_tg1', kind: 'tg', owner: 'personal', ownerId: 'e1', displayName: 'Telegram · мій', externalRef: '+38 099 445 12 83', status: 'online' },
  ];

  const mkClick = (
    kind: ChannelKind,
    minutesAgo: number,
    utm: [string, string, string],
    gclid?: string,
  ): Click => ({
    clickId: genCid(),
    channelKind: kind,
    utmSource: utm[0],
    utmMedium: utm[1],
    utmCampaign: utm[2],
    gclid,
    ipHash: hashStr(`ip-${rnd(1e9)}`),
    uaHash: hashStr(`ua-${rnd(1e9)}`),
    createdAt: now - minutesAgo * MIN,
  });

  const utmGoogle: [string, string, string] = ['google', 'cpc', 'rl_search_ua'];
  const utmMeta: [string, string, string] = ['meta', 'social', 'ig_reels_ua'];

  const clickWa = mkClick('wa', 47, utmGoogle, 'Cj0KCQjw8pDOBhCRARIsAKXZppF7uZxvQm4Yk0lT2wNhBxaLKiOsJxYQe5zJrEvF');
  const clickTg = mkClick('tg', 52, utmGoogle, 'Cj0KCQjw8pDOBhCRARIsAKXZppG1sKdR8nJqLmVeW2XcAytPbqfHiUoM3nTrGaC0');
  const clickVb = mkClick('viber', 70, utmMeta);

  const seeds: SeedConv[] = [
    {
      channelId: 'ch_wa', name: 'Андрій Шевчик', phone: '+38 067 830 12 45', minutesAgo: 7, unread: 1,
      attribution: 'exact', utm: utmGoogle, gclid: clickWa.gclid,
      msgs: [
        ['in', 'Вітаю! Вивчаю умови оренди приміщення на Подолі. Що з депозитом?', 9],
        ['out', 'Добрий день, Андрію! Депозит — 50% місяця. Надісла Commercial пропозицію', 8],
        ['in', 'Прийняв! Вивчаю. Чи можна подивитись завтра о 12:00?', 7],
      ],
    },
    {
      channelId: 'ch_tg', name: 'Ігор Козак', phone: '+38 050 771 03 92', minutesAgo: 6, unread: 2,
      attribution: 'exact', utm: utmGoogle, gclid: clickTg.gclid,
      msgs: [
        ['in', 'Добрий день! Цікавить оренда складу 200 м². Що по ціні?', 12],
        ['out', 'Вітаю, Ігоре! 200 м² — 185 грн/м². Все включено, окрім комунальних', 10],
        ['in', 'А який термін мінімальної оренди?', 8],
        ['in', 'І чи є паркомісця для співробітників?', 6],
      ],
    },
    {
      channelId: 'ch_vb', name: 'Олена Красенко', phone: '+38 063 220 51 18', minutesAgo: 12, unread: 1,
      attribution: 'fallback', utm: utmMeta,
      msgs: [
        ['in', 'Підкажіть, будь ласка, чи є вільні офіси на 4 поверсі?', 14],
        ['out', 'Добрий день, Олено! Так, є два варіанти: 48 м² та 76 м². Показати планування?', 13],
        ['in', 'Так, надішліть, будь ласка.', 12],
      ],
    },
    {
      channelId: 'ch_wa', name: "Мар'яна Ковальчук", phone: '+38 098 114 76 30', minutesAgo: 18, unread: 0,
      attribution: 'exact', utm: utmGoogle, gclid: clickWa.gclid,
      msgs: [
        ['in', 'Доброго дня! Хотіла уточнити: у рахунку зазначено послоду «юридичний супровід» — це обовʼязково?', 22],
        ['out', "Добрий день, Мар'яно! Так, це стандартна умова договору оренди. 1 200 грн/міс", 20],
        ['in', 'Зрозуміло. Дякую, оплачую сьогодні.', 18],
      ],
    },
    {
      channelId: 'ch_tg', name: 'Тарас Лисенко', phone: '@taras_l', minutesAgo: 24, unread: 0,
      attribution: 'exact', utm: utmGoogle, gclid: clickTg.gclid,
      msgs: [
        ['in', 'Вітаю. Розсимваю обʼєкт на Хрещатику — чи працюєте в центрі?', 30],
        ['out', 'Вітаю, Тарасе! Так, працюємо по всьому Києву. Що за обʼєкт?', 28],
        ['in', 'Шукаю офіс 120-150 м². Ошатне. Сплануєте перегляд?', 24],
      ],
    },
    {
      channelId: 'ch_wa', name: 'Наталія Бондаренко', phone: '+38 066 903 44 27', minutesAgo: 51, unread: 0,
      attribution: 'direct',
      msgs: [
        ['in', 'Добрий день! Знайшла ваш номер на сайті. Чи здаєте приміщення під салон краси?', 55],
        ['out', 'Добрий день, Наталіє! Так, є варіанти з окремим входом. Розповісти деталі?', 53],
        ['in', 'Так, дякую! Основне — вологість та електро потужність.', 51],
      ],
    },
    {
      channelId: 'ch_vb', name: 'Віталій Гриценко', phone: '+38 093 552 87 60', minutesAgo: 65, unread: 2,
      attribution: 'fallback', utm: utmMeta,
      msgs: [
        ['in', 'Добрий день. Шукаю приміщення під міні-пекарню, Дарницький район. Що є?', 70],
        ['out', 'Вітаю, Віталію! Є дві пропозиції на Дарниці. Важлива вентиляція та потужність — обидва підходять', 68],
        ['in', 'Чудово. Яка вартість і чи можна дивитись у суботу?', 65],
      ],
    },
    {
      channelId: 'ch_p_tg1', name: 'Максим Гончар', phone: '@mgonchar', minutesAgo: 9, unread: 1,
      msgs: [
        ['in', 'Олено, скинь комерційне по Склянці, будь ласка. Обговорюємо з директором', 11],
        ['out', 'Надсилаю PDF. Там актуальні ціни з сьогоднішнього перерахунку', 10],
        ['in', 'Дякую! Отримав.', 9],
      ],
    },
  ];

  const conversations: Conversation[] = [];
  const messages: Record<string, Message[]> = {};
  const clicks = [clickWa, clickTg, clickVb];

  for (const s of seeds) {
    const channel = channels.find((c) => c.id === s.channelId)!;
    const convId = uid();
    const click = clicks.find((c) => c.channelKind === channel.kind && c.utmSource === s.utm?.[0]);
    conversations.push({
      id: convId,
      channelId: s.channelId,
      personal: channel.owner === 'personal',
      contactName: s.name,
      phone: s.phone,
      attribution: s.attribution,
      clickId: s.attribution === 'exact' && click ? click.clickId : undefined,
      utmSource: s.utm?.[0],
      utmMedium: s.utm?.[1],
      utmCampaign: s.utm?.[2],
      gclid: s.gclid,
      unread: s.unread,
      lastTs: now - s.minutesAgo * MIN,
    });
    messages[convId] = s.msgs.map(([dir, body, mAgo]) => ({
      id: uid(),
      conversationId: convId,
      direction: dir,
      body,
      ts: now - mAgo * MIN,
      status: dir === 'out' ? 'read' : 'sent',
    }));
  }

  return { employees, currentUserId: 'e1', channels, conversations, messages, clicks };
}

const NAMES = [
  'Олександр Ткаченко', 'Ірина Мельник', 'Сергій Бабенко', 'Юлія Романюк',
  'Павло Кравець', 'Анна Левченко', 'Микола Савенко', 'Катерина Гончар',
];

const BODIES = [
  'Добрий день! Цікавить оренда. Що є вільного?',
  'Вітаю! Написав з сайту. Чи можна переглянути обʼєкт?',
  'Доброго дня! Яка вартість за м² зараз?',
  'Вітаю. Підкажіть, чи є паркінг у бізнес-центрі?',
  'Добрий день! Отримав рахунок — є пара питань.',
  'Привіт! Вчора дивились приміщення, хочемо продовжити.',
];

export function randomIncomingBody(): string {
  return pick(BODIES);
}

export function randomName(): string {
  return pick(NAMES);
}

export function randomUtm(): { utm: [string, string, string]; gclid?: string } {
  if (Math.random() < 0.5) {
    return { utm: ['google', 'cpc', 'rl_search_ua'], gclid: `Cj0KCQj${genCid()}${genCid()}` };
  }
  return { utm: ['meta', 'social', 'ig_reels_ua'] };
}
