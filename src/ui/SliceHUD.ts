import { config } from '../data/config';
import type { SliceController } from '../debug/SliceController';

const escape = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);

/** 紧凑辅助栏；派遣、移动与镇压的主要入口在世界场景。 */
export class SliceHUD {
  private lastMarkup = '';
  private detailsHidden = false;
  private logsExpanded = false;
  constructor(private readonly root: HTMLElement, private readonly controller: SliceController) {
    root.innerHTML = `<header class="slice-top"><div class="slice-brand"><span class="agency-mark">▥</span><div><strong>网梗收容：奶龙失效</strong><small>设施 07 · N01 空间调度试验</small></div></div><span class="slice-scope">两人调试场景</span><span id="slice-production"></span><span id="slice-wallet"></span><span id="slice-clock"></span><button data-action="pause">暂停 · 空格</button></header>
      <aside class="slice-inspector"><div class="slice-section-title"><span>现场监控</span><button data-action="toggle-details" aria-label="收起详情">−</button></div><div id="slice-details"></div></aside>
      <section class="slice-bottom"><div class="slice-controls"><span><kbd>左键</kbd> 点选 / 拖框</span><span><kbd>Shift</kbd> 加选</span><span><kbd>右键</kbd> 走廊移动 / 敌人镇压</span><span><kbd>R</kbd> 撤退　<kbd>S</kbd> 停止</span></div><div id="slice-message" role="status"></div><small>程序绘制概念占位 · 调试场景不写正式存档 · 正式第一日仍为四人</small></section>`;
    root.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
      if (!button) return;
      switch (button.dataset.action) {
        case 'pause': controller.togglePause(); break;
        case 'retreat': controller.retreat(); break;
        case 'stop': controller.stop(); break;
        case 'breach': controller.triggerBreach(); break;
        case 'toggle-details': this.detailsHidden = !this.detailsHidden; break;
        case 'toggle-logs': this.logsExpanded = !this.logsExpanded; break;
      }
      this.render();
    });
    window.addEventListener('keydown', event => {
      if (event.code === 'KeyB' && !event.repeat && !(event.target instanceof HTMLInputElement)) {
        controller.triggerBreach(); this.render();
      }
    });
    this.render();
  }
  render(): void {
    const { state } = this.controller;
    const room = state.rooms.find(item => item.anomalyId === 'N01')!;
    this.root.querySelector('#slice-production')!.textContent = `累计产能 ${state.producedToday}`;
    this.root.querySelector('#slice-wallet')!.textContent = `可用能量 ${state.progress.wallet}`;
    this.root.querySelector('#slice-clock')!.textContent = `${state.simulationTimeSec.toFixed(1)} s`;
    this.root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.textContent = state.timeScale === 0 ? '继续 · 空格' : '暂停 · 空格';
    this.root.querySelector('#slice-message')!.textContent = this.controller.message;
    this.root.querySelector('.slice-inspector')!.classList.toggle('collapsed', this.detailsHidden);
    const body = this.root.querySelector<HTMLElement>('#slice-details')!;
    body.hidden = this.detailsHidden;
    this.root.querySelector('[data-action="toggle-details"]')!.textContent = this.detailsHidden ? '+' : '−';
    if (this.detailsHidden) return;
    const selected = state.employees.filter(employee => this.controller.selected.has(employee.id));
    const enemy = state.enemies.find(item => item.id === this.controller.selectedEnemyId);
    const mode = { CONTAINED: '收容稳定', BREACHED: '失效 · 产能停止', RECOVERING: '重建收容 · 产能停止', LOCKED: '未开放' }[room.mode];
    const markup = `<div class="slice-room-status ${room.mode === 'BREACHED' ? 'danger' : ''}"><small>N01 · 奶龙</small><strong>${mode}</strong><span>压力 ${room.pressure.toFixed(0)} / ${config.game.pressure.breachThreshold}</span>${room.work ? `<span>${room.work.phase === 'TRAVELLING' ? '员工前往工作位' : '正在室内作业'} · ${room.work.elapsedSec.toFixed(1)} s</span>` : ''}</div>
      <p class="slice-selection">${selected.length ? `已选 ${selected.length} 人` : enemy ? `${enemy.isClone ? '分身' : '主样本'} · ${enemy.suppressionHp.toFixed(0)} / ${enemy.suppressionHpMax}` : '在场景里点击小人'}</p>
      ${state.employees.map(employee => `<div class="slice-vitals ${this.controller.selected.has(employee.id) ? 'selected' : ''}"><div><b>${employee.displayName}</b><span>${escape(config.localization[`employee.${employee.status}`] ?? employee.status)}</span></div><label>生命 <meter min="0" max="${employee.hpMax}" value="${employee.hp}"></meter><span>${employee.hp.toFixed(0)}</span></label><label>精神 <meter min="0" max="${employee.spMax}" value="${employee.sp}"></meter><span>${employee.sp.toFixed(0)}</span></label></div>`).join('')}
      <div class="slice-orders"><button data-action="retreat" ${selected.length ? '' : 'disabled'}>撤退 · R</button><button data-action="stop" ${selected.length ? '' : 'disabled'}>停止 · S</button></div>
      <p class="slice-help">点击收容室安排工作。<br>选中员工后，右键场内敌人下达镇压；员工到射程后自动出手。</p>
      <div class="slice-debug"><small>场景调试工具</small><button data-action="breach" ${room.mode === 'CONTAINED' ? '' : 'disabled'}>触发真实失效 · B</button><p>用于检查主样本、分身与撤退。<br>不修改伤害、生命或工作收益。</p></div>
      <div class="slice-log"><button data-action="toggle-logs">${this.logsExpanded ? '收起' : '展开'}事件记录</button>${state.logs.slice(this.logsExpanded ? -8 : -2).map(log => `<p><time>${log.timeSec.toFixed(1)}</time> ${escape(log.message)}</p>`).join('')}</div>`;
    if (markup !== this.lastMarkup) { body.innerHTML = markup; this.lastMarkup = markup; }
  }
}
