// 启动前的数据验证或资源载入失败也必须有可见反馈，不能只留空白画布。
void import('./main').catch((error: unknown) => {
  const panel = document.createElement('section');
  panel.setAttribute('role', 'alert');
  panel.style.cssText = 'position:fixed;inset:8%;overflow:auto;background:#f3f1e5;color:#243640;border:2px solid #c86147;padding:32px;white-space:pre-wrap;font:16px/1.7 "Microsoft YaHei",sans-serif;z-index:9999';
  panel.textContent = `游戏启动失败\n\n${error instanceof Error ? error.message : String(error)}\n\n请检查所列配置文件与字段。已有存档未被修改。`;
  document.body.append(panel);
});
