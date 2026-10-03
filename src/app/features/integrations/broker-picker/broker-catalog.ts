/** Only implemented integrations belong in this catalog. Adding an entry also
 * requires a matching connection flow; roadmap items must not be selectable. */
export const TRADOVATE_BROKER = {
    id: 'tradovate',
    name: 'Tradovate',
    logo: '/brokers/tradovate-icon.png',
    description: 'Futures accounts, including supported prop firms.',
} as const;

export const BROKER_CATALOG = [TRADOVATE_BROKER] as const;
export type BrokerId = (typeof BROKER_CATALOG)[number]['id'];
