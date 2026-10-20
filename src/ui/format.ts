import type { DamageSpec, Resistances } from '../../contracts/data-contract';
import { config } from '../data/config';

export const text = (key: string): string => config.localization[key] ?? key;
export const number = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1);
export const seconds = (value: number): string => `${Math.max(0, Math.ceil(value))}秒`;
export const clock = (value: number): string => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
export const escape = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
export const damageName = (type: keyof Resistances): string => ({ RED: '红', WHITE: '白', BLACK: '黑', PALE: '苍白' })[type];
export const damageText = (damage: DamageSpec): string => `${damageName(damage.type)} ${damage.kind === 'MAX_RATIO' ? `${number(damage.amount * 100)}%最大值` : number(damage.amount)}`;
export const resistanceText = (values: Resistances): string => config.game.combat.resistanceOrder.map((key) => `${damageName(key)} ${number(values[key])}`).join(' / ');

