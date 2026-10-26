/** v0.6 机构 HUD 图标：统一 24px 网格、圆角线条，颜色由宿主状态决定。 */
export const iconPaths = {
  income: '<path d="M13.5 2.8 5.9 13h5.3l-.8 8.2L18.1 11h-5.3z" fill="currentColor" fill-opacity=".18"/><path d="M3 5.5h3M2.5 9h2"/>',
  energy: '<path d="m12 2.8 7.8 5.1v8.2L12 21.2l-7.8-5.1V7.9z" fill="currentColor" fill-opacity=".14"/><path d="m12 6.6 4.2 5.4-4.2 5.4L7.8 12z"/>',
  containment: '<path d="m3.4 9 8.6-6.1L20.6 9v10.6a1.5 1.5 0 0 1-1.5 1.5H4.9a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M8 14.5 10.7 17l5.3-5.5"/>',
  field: '<path d="M5 21V3.2M5 4c5-3 8.5 3.2 14 .2v10c-5.5 3-9-3.2-14-.2" fill="currentColor" fill-opacity=".12"/>',
  upgrade: '<path d="M8 20v-8H4.5L12 3l7.5 9H16v8z" fill="currentColor" fill-opacity=".16"/><path d="M10.5 16h3"/>',
  lock: '<rect x="4.8" y="10" width="14.4" height="11" rx="2.2" fill="currentColor" fill-opacity=".1"/><path d="M8 10V6.7a4 4 0 0 1 8 0V10M12 14.2v2.7"/>',
  challenge: '<path d="m4 3.5 4.7 1.6L17 13.4l-3.6 3.6L5.1 8.7zM11.7 18.8l7.1-7.1M16 17l4.5 4.5M19 3.5l-3.7 1.3-2.2 2.3M6.8 14.7l-2 2M3.5 20.5l3-3"/>',
  move: '<path d="M6.2 3.2c2-.4 3.5 2.2 3.2 4.4-.2 1.6-1.3 2.7-2.7 2.4-1.8-.3-2.7-2.1-2.7-3.7 0-1.5.8-2.8 2.2-3.1ZM17.2 11.3c2-.4 3.5 2.2 3.2 4.4-.2 1.6-1.3 2.7-2.7 2.4-1.8-.3-2.7-2.1-2.7-3.7 0-1.5.8-2.8 2.2-3.1Z" fill="currentColor" fill-opacity=".12"/><path d="m5.2 13 .5 2M16.2 21l-.4-1.2"/>',
  idle: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
  work: '<path d="M8 7V4.8A1.8 1.8 0 0 1 9.8 3h4.4A1.8 1.8 0 0 1 16 4.8V7"/><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 12.3c5.8 2.2 12.2 2.2 18 0M10.5 12v4h3v-4"/>',
  injury: '<path d="M8.5 3h7v5.5H21v7h-5.5V21h-7v-5.5H3v-7h5.5z" fill="currentColor" fill-opacity=".15"/>',
  panic: '<path d="M5 13.5v-4a7 7 0 0 1 14 0v4.2l2 2.8h-3V21H9v-3.5H7a2 2 0 0 1-2-2z"/><path d="m12.8 6.8-2.4 4h3.2l-2 3.4"/>',
  deploy: '<circle cx="8" cy="6.5" r="3"/><path d="M2.8 20v-3.5a5.2 5.2 0 0 1 10.4 0V20M15 13h6m-3-3 3 3-3 3"/>',
  stable: '<path d="M12 2.8 20 6v5.2c0 5-4.6 8.8-8 10-3.4-1.2-8-5-8-10V6z" fill="currentColor" fill-opacity=".12"/><path d="m8 11.7 2.7 2.8 5.3-5.2"/>',
  interact: '<path d="M7.5 12V5a1.6 1.6 0 0 1 3.2 0v5.8-2a1.6 1.6 0 0 1 3.2 0v2-1a1.6 1.6 0 0 1 3.2 0v1.5a1.6 1.6 0 0 1 3.2 0v3.4c0 3.9-2 6.3-5.4 6.3h-2.1c-2 0-3.3-.8-4.4-2.2L4 13.5a1.7 1.7 0 0 1 2.3-2.4z"/>',
  archive: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8.5 12h7M8.5 16h5"/>',
  save: '<path d="M4 3h13l3 3v15H4z"/><path d="M8 3v6h8V3M8 21v-7h8v7M13.5 5.5v1"/>',
  pause: '<rect x="5" y="3.5" width="4.5" height="17" rx="1" fill="currentColor" fill-opacity=".25"/><rect x="14.5" y="3.5" width="4.5" height="17" rx="1" fill="currentColor" fill-opacity=".25"/>',
  play: '<path d="M6.5 3.5 20 12 6.5 20.5z" fill="currentColor" fill-opacity=".25"/>',
  speed: '<path d="m3 5 8 7-8 7zM13 5l8 7-8 7z" fill="currentColor" fill-opacity=".15"/>',
  follow: '<path d="M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5"/><circle cx="12" cy="9" r="2.8"/><path d="M7.5 17a4.5 4.5 0 0 1 9 0"/>',
  home: '<path d="m2.8 10 9.2-7.2 9.2 7.2M5 8.3V21h14V8.3M9.5 21v-8h5v8"/>',
  equipment: '<path d="m8 3 4 3 4-3 5 5-3.5 4-2-2V21h-7V10l-2 2L3 8z" fill="currentColor" fill-opacity=".1"/><path d="M12 7v8M10.3 17h3.4"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.7"/><path d="M12 6.5V12l4 2.5"/>',
  staff: '<circle cx="9" cy="6.8" r="3.3"/><path d="M2.5 21v-3.5a6.5 6.5 0 0 1 13 0V21M16 4.3a3.3 3.3 0 0 1 0 6.4M18 14a5.5 5.5 0 0 1 3.5 5.2V21"/>',
  help: '<circle cx="12" cy="12" r="8.7"/><path d="M9.4 8.5a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.1-2.6 4"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
} as const;

export type IconName = keyof typeof iconPaths;

/** 装饰性 SVG 的读屏名称由外层 button / title 承担，避免重复播报。 */
export function icon(name: IconName): string {
  return `<svg class="ui-icon v06-icon" data-icon="${name}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${iconPaths[name]}</svg>`;
}
