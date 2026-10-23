import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const work = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(work, '../..');
const outDir = path.join(root, 'outputs/01a144a7-9b8e-7ec0-91c1-cb1e9446d500');
const outfile = path.join(outDir, '网梗收容_美术素材生成需求_v1.0_20261021.xlsx');
const read = async name => JSON.parse((await fs.readFile(path.join(work, name), 'utf8')).replace(/^\uFEFF/, ''));
const [characters, environment, effects, charUnits, envUnits] = await Promise.all([
  read('characters.json'), read('environment.json'), read('ui_vfx.json'),
  read('characters_units.json'), read('environment_units.json'),
]);
const all = [...characters, ...environment, ...effects];
const ranks = { P0: 0, P1: 1, P2: 2 };
all.sort((a, b) => ranks[a.priority] - ranks[b.priority]);
const rootSlash = root.replaceAll('\\', '/') + '/';
all.forEach(a => {
  a.source = a.source.replaceAll('\\', '/').replaceAll(rootSlash, '').replace('C:/Users/SEASUN/.codex/attachments/7f5d4409-cd91-4d45-b37e-b4e2248fafc7/已粘贴的文本.txt','用户提供《美术替换指南》');
  a.requirements = a.requirements.replaceAll('characters_units.json 对应 focus','「逐张提示词」本张范围');
  if (/PSD|分层源|挂点 JSON/.test(a.export)) a.export += ' 分层源文件与挂点记录由后处理制作，不要求图像模型直接生成。';
});
const clean = value => Array.isArray(value) ? value.join(' / ') : String(value ?? '');
const colors = { ink: '#283D40', teal: '#376366', pale: '#F3F5F2', paper: '#FBF8F0', amber: '#FFF1CD', line: '#D9E1DD', muted: '#61716D', red: '#9D5345', white: '#FFFFFF' };
const font = { name: 'Microsoft YaHei', size: 10, color: '#253835' };

const gallery = 'docs/art-evidence-2026-10-20/visual-2026-10-20T09-16-02.891Z/';
const references = [
  { id:'REF_OVERVIEW', name:'设施总览｜分区与空间关系', file:'docs/showcase/art-facility-overview.png', use:'参考不齐整的多层分区、收容室与走廊的连接；不要生成整张关卡背景。墙、地板、门、窗和设备均按需求拆件。' },
  { id:'REF_STAFF', name:'员工｜制服、比例与手持装备', file:'docs/showcase/art-personnel.png', use:'参考实际员工的头身关系、着装与持械部位；加强墨线与剪纸感。场景中必须仍是有四肢的可操作小人。' },
  { id:'REF_PANIC', name:'员工恐慌｜姿势与紫色提示', file:'docs/showcase/art-personnel-panic.png', use:'参考身体紧缩、手势和神态；涂抹只作短时表现，不能挡住人物轮廓与血条。' },
  { id:'REF_DOWN', name:'员工重伤｜倒地剪影', file:'docs/showcase/art-personnel-incapacitated.png', use:'参考同一员工倒地后的形状。是当日重伤退出，不是永久死亡；不生成尸体、血腥断肢或墓碑。' },
  { id:'REF_ARCHIVE', name:'档案终端｜信息层级与无字底板', file:'docs/showcase/art-archive.png', use:'参考米纸档案、暗框与克制的数据库感；禁止将截图内文字、读数、按钮和动态状态印入底图。' },
  { id:'REF_COMBAT', name:'近距离镇压｜实际命中反馈', file:'docs/showcase/art-suppression-contact.png', use:'只参考持械接敌和短促命中反馈；射程、范围、路径、血条和判定由真实游戏状态绘制。' },
  { id:'REF_N01_CALM', name:'N01 奶龙｜收容状态', file:gallery+'04-N01-contained.png', use:'保留软黄圆润、短手和可辨识头脸；统一手绘线条，不沿用程序图的几何生硬感。' },
  { id:'REF_N01_BREACH', name:'N01 奶龙｜失效状态', file:gallery+'12-N01-actual-breach.png', use:'观察主样本与场内分身。失效以空洞眼、裂嘴和拉伸轮廓变化；分身复用同一素材，不另造新怪物。' },
  { id:'REF_N02_CALM', name:'N02 耄耋｜收容状态', file:gallery+'05-N02-contained.png', use:'保留灰猫、慢吞吞和古怪表情；脸与背部轮廓比毛发纹理更重要。' },
  { id:'REF_N02_BREACH', name:'N02 耄耋｜失效状态', file:gallery+'15-N02-actual-breach.png', use:'参考长肢、扭曲和抓击形态；必须与平静状态剪影不同，不能只换色。' },
  { id:'REF_N03_CALM', name:'N03 大狗｜收容状态', file:gallery+'06-N03-contained.png', use:'保留笨重灰褐体型和憨态，地面接触清楚；纹理从简。' },
  { id:'REF_N03_BREACH', name:'N03 大狗｜失效状态', file:gallery+'18-N03-actual-breach.png', use:'前倾剪影、夸张开口和阴影构成危险信号；不把攻击扇区烘焙到狗身上。' },
  { id:'REF_N04_CALM', name:'N04 叮咚鸡｜收容状态', file:gallery+'07-N04-contained.png', use:'保留鸡与提示广播的荒诞组合。钟/喇叭元素克制，任何数字由程序补。' },
  { id:'REF_N04_BREACH', name:'N04 叮咚鸡｜失效状态', file:gallery+'19-N04-actual-breach.png', use:'张嘴广播、身体拉伸；扫描残影与预警范围分离，素材仅交付主形关键图。' },
  { id:'REF_N05_CALM', name:'N05 咕咕嘎嘎｜收容状态', file:gallery+'08-N05-contained.png', use:'保留冷色企鹅与木讷站姿；不画冰雪自然场景背景。' },
  { id:'REF_N05_BREACH', name:'N05 咕咕嘎嘎｜失效状态', file:gallery+'20-N05-actual-breach.png', use:'不对称脸部与拉伸外形体现失效；重复轮廓由运行时残影负责，不能生成多个实体冒充分身。' },
];
const refSet = new Set(references.map(r => r.id));
const ids = new Set(all.map(a => a.id));
if (ids.size !== all.length) throw new Error('Duplicate requirement IDs');
if (new Set(all.map(a => a.name)).size !== all.length) throw new Error('Duplicate names');
for (const a of all) {
  if (!/^[a-z0-9_]+$/.test(a.name)) throw new Error('Bad asset name '+a.name);
  for (const id of a.referenceIds) if (!refSet.has(id)) throw new Error('Missing reference '+id);
  for (const id of a.dependsOn) if (!ids.has(id)) throw new Error('Missing dependency '+a.id+' -> '+id);
}
const units = [];
for (const a of all) {
  if (a.quantity === 0) continue;
  let parts = charUnits[a.id] ?? envUnits[a.id];
  if (!parts && a.id === 'UI_014') parts = [
    { suffix:'walk', displayName:'移动状态图标', canvas:'512×512 px', focus:'仅生成一个前倾迈步的简化侧身小人符号，表达移动，方向向右；不画撤退图标或整身角色立绘。' },
    { suffix:'retreat', displayName:'撤退状态图标', canvas:'512×512 px', focus:'仅生成一个返回门口箭头符号，表达撤退；不画移动小人图标，与移动图标保持同线宽和视觉重量。' },
  ];
  if (!parts && a.quantity === 1) parts = [{suffix:'', displayName:a.displayName, canvas:a.canvas, focus:a.requirements}];
  if (!parts || parts.length !== a.quantity) throw new Error('Unit mismatch '+a.id+' '+a.quantity);
  parts.forEach(p => {
    const suffix = p.suffix ? '_'+p.suffix : '';
    const folder = a.id.startsWith('ENV') ? 'environment' : a.id.startsWith('UI') ? 'ui' : a.id.startsWith('VFX') ? 'vfx' : /abn_|abnormal|N0/.test(a.name) ? 'abnormalities' : /weapon_|armor_|equip_/.test(a.name) ? 'equipment' : 'characters';
    const unitExport = a.quantity > 1
      ? '本次仅一张单件 PNG，sRGB；'+(/透明|RGBA|Alpha/.test(a.export)?'真实 Alpha 透明背景；':'保留本张要求的平铺/底图不透明区域；')+(/母版|同坐标/.test(a.export)?'沿用装配母版位置，不自动裁切；':'保持足够安全边距；')+'尺寸修正、边缘清理、分层源文件及轴点记录由后处理制作。'
      : a.export;
    units.push({ a, ...p, unitExport, filename:a.name+suffix+'.png', folder:'art_delivery/v1/'+folder+'/' });
  });
}
if (new Set(units.map(u=>u.filename)).size !== units.length) throw new Error('Duplicate output filenames');

const wb = Workbook.create();
const req = wb.worksheets.add('素材需求');
const prompts = wb.worksheets.add('逐张提示词');
const spec = wb.worksheets.add('生成规范');
const refs = wb.worksheets.add('参考图');
function col(n) { let s=''; for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s; }
function base(sheet, widths, rows) {
  sheet.showGridLines = false;
  sheet.tabColor = colors.teal;
  sheet.getRange(`A1:${col(widths.length)}${rows}`).format = { font, fill:colors.white, wrapText:true, verticalAlignment:'top' };
  widths.forEach((w,i)=>sheet.getRange(`${col(i+1)}1:${col(i+1)}${rows}`).format.columnWidthPx=w);
  sheet.getRange(`A1:${col(widths.length)}${rows}`).format.rowHeightPx=24;
}
function title(sheet, text, subtitle, last) {
  sheet.getRange(`A1:${last}2`).format.fill=colors.ink;
  sheet.getRange('A1').values=[[text]];
  sheet.getRange(`A1:${last}1`).format={font:{...font,size:18,bold:true,color:colors.white},wrapText:false,rowHeightPx:42};
  sheet.getRange('A2').values=[[subtitle]];
  sheet.getRange(`A2:${last}2`).format={font:{...font,size:10,color:'#D7E8E2'},wrapText:false,rowHeightPx:30};
}
function header(sheet,row,labels) {
  sheet.getRange(`A${row}:${col(labels.length)}${row}`).values=[labels];
  sheet.getRange(`A${row}:${col(labels.length)}${row}`).format={fill:colors.teal,font:{...font,bold:true,color:colors.white},verticalAlignment:'center',rowHeightPx:38};
}
function table(sheet, start, end, cols, name) {
  const t=sheet.tables.add(`A${start}:${col(cols)}${end}`,true,name);
  t.showFilterButton=true;
  for(let r=start+1;r<=end;r++) {
    sheet.getRange(`A${r}:${col(cols)}${r}`).format.fill=(r-start)%2 ? colors.white : colors.pale;
    sheet.getRange(`A${r}:${col(cols)}${r}`).format.borders={bottom:{style:'thin',color:colors.line}};
  }
  sheet.freezePanes.freezeRows(start);
  sheet.freezePanes.freezeColumns(4);
}
function calcHeight(values,widths,size=10,max=500) {
  const lines=values.map((v,i)=>String(v??'').split('\n').reduce((s,l)=>s+Math.max(1,Math.ceil([...l].reduce((n,c)=>n+(c.charCodeAt(0)>255?1:0.55),0)/Math.max(4,(widths[i]-14)/(size*1.333)))),0));
  return Math.min(max,Math.max(60,Math.max(...lines)*(size*1.333+5)+18));
}

// Shared, editable production contract. B8 is the style source used by every prompt.
base(spec,[180,1030],48);
title(spec,'生成规范｜怪诞手绘收容风','v1.0 · 2026-10-21 · 本次交付是美术生产需求，不代表图片已生成或已接入', 'B');
const specification = [
  ['使用顺序','先看本页 → 在「素材需求」按 P0 筛选 → 打开「参考图」对应 REF → 到「逐张提示词」复制 D 列完整提示词并附上参考图。按依赖先定稿，再生成拆件。'],
  ['数量口径','「素材需求」一行是一组需求；「逐张提示词」一行是一张独立 PNG。动作参考也是单姿势图片，不是可直接播放的动画。数量为 0 的条目继续由程序绘制。'],
  ['交付阶段','先通过角色/收容物定稿，再出拆件和姿势参考，最后接环境与 UI/VFX。P0=第一批统一风格与基本可玩画面；P1=状态及细节补全；P2=远景装饰。'],
  ['参考使用','工作簿已嵌入 16 张当前游戏真实截图，供身份、空间与动作参考；这些图不是最终美术质量目标。外部风格只取《饥荒》的粗墨线、平涂与怪诞童话原则；不复制其具体角色、场景或纹样。'],
  ['统一风格提示词','原创二维地下工业收容设施游戏美术；怪诞手绘收容风，受手绘怪诞生存童话的表现原则启发。hand-drawn, ink-outline, slightly grotesque, whimsical horror, 2D cutout-friendly。粗细有变化的深墨轮廓，轻微不规则手绘线，大面积低饱和平涂，少量刻线阴影；剪影与动作优先于纹理。正交二维侧视角色/设施，UI为正视平面。保留对象身份，统一视觉语言，不复制其他作品具体资产。'],
  ['统一禁止项','不做 3D、照片写实、厚涂油画、等距俯视、高饱和二次元、霓虹光污染、密集脏污；不加文字、数字、二维码、水印、游戏界面或棋盘格背景；不把动态状态、血条、范围、路径烘焙进图。'],
  ['图像模型职责','每次只出一张单件图/单姿势关键图。模型不负责真正的 PSD 分层、SVG、可用动画图集、九宫格工程或精准轴点元数据。确认定稿后，用拆件/裁切/去底工具制作实际资源，保留源图。'],
  ['共同导出规范','优先 sRGB PNG。角色、道具、前景、图标和特效需真实 Alpha；墙面/底图与 UI 内部暗底按各行要求保留不透明。无白边/黑晕/伪透明。建议边缘留 8%–12%安全区，不裁断四肢和武器；按各行验收处理。'],
  ['画布与游戏尺寸','表内画布为建议生产像素，不改配置与逻辑坐标。模型不支持该尺寸时先生成相同比例的最高可用分辨率，再统一缩放/裁切到目标画布。员工约 66 逻辑像素、地图 3600×2500；不要把这些当生成分辨率。'],
  ['人物与骨架','员工 2.5–3.5 头身，头较大、身体小、细长四肢、完整制服及手持武器。头/躯干/上下臂/大小腿与表情分离；同人所有姿势维持比例、服装和面孔。中性朝右，运行时镜像朝左；非对称结构另按行处理。'],
  ['生物状态','只做奶龙、耄耋、大狗、叮咚鸡、咕咕嘎嘎。收容/工作/失效须有剪影或姿态差异；每物最多 3 组主色。先确认 calm / breach 定稿，再生成动作参考与拆件；不新增收容物或失效机制。'],
  ['程序状态边界','画面绑定同一实际游戏状态。移动、攻击、工作计时、攻击范围、选中/路径、血条/进度、数值/文案由程序绘制和结算；暂停冻结动作。N01 分身复用主形；N04/N05 的残影只作渲染，不制造实体。'],
  ['受伤与装备边界','重伤是本日退出，次日恢复；无永久死亡。低 HP 慢动作只允许视觉表现，不改变真实移动速度。装备仅提供既有四属性数值，不画出暗示新增被动/技能的功能结构或特效。'],
  ['环境装配','墙壳、地板、门框/门扇、观察窗框/玻璃、设备与前景拆开；门与工作位保持既有坐标。中央走路区域留空，装饰不遮选人/观察窗。设施约占默认视区 65%以上，当前区域布局不能被整张背景替代。'],
  ['视觉优先级','危险预兆 > 收容物 > 员工状态 > 房间用途 > 背景装饰。平时低饱和；红色告警、紫色恐慌、淡黄/青色选择提示克制而清楚。现有压力提醒不是新增“熔毁”系统。'],
  ['命名与目录','逐张提示词 B 列给出最终建议文件名，L 列为回传目录。全部英文小写 snake_case；变体只追加 _v02 等版本号，保留原 ID。建议同时回传原始生成图和清理后的 PNG，不能只给压缩聊天预览。'],
  ['交付后接入','当前大部分画面是 Phaser 程序绘制，只有少量 UI SVG。表中 PNG 是新生产目标，仍需加载纹理、骨架/轴点装配、切片和状态绑定，放进目录不会自动替换现有游戏。交付前不得以静态图替代实机验收。'],
  ['验收一：风格','同屏线宽/光源/饱和度统一；66px 附近的员工仍可识别四肢与武器；缩略尺寸能分辨五物与 calm/breach。怪诞但不靠堆噪点或写实血腥。'],
  ['验收二：技术','单件数量与名称匹配；Alpha 边缘清洁；同系列脚底/关节锚点一致；可平铺模块无亮缝；门与窗可独立装配；UI 拉伸不变形且正文可读。不能把概念姿势当完成动画。'],
  ['验收三：实机','接入后重走移动途中改令 → 进室工作 → 收容失效 → 镇压/撤退，并检查暂停。检查实际 1600×900 / 1280×720 与缩放画面；本工作簿本身不构成这一步的通过证明。'],
  ['需求来源','用户粘贴《网梗收容：奶龙失效》美术替换指南；项目 AGENTS.md / CODEX_START.md / docs/00_产品形态与视觉验收.md；docs/ART_STYLE_GUIDE.md、ASSET_REPLACEMENT_PLAN.md、ASSET_NAMING_CONVENTION.md、UI_STYLE_GUIDE.md、ABNORMALITY_VISUAL_RULES.md。逐项实现来源见主表。'],
  ['调色板 / 基底','深墨 #211E24；空腔 #181A20；旧纸 #D9C9A4；纸暗 #B3A485；墙灰 #8C8D7D；墙暗 #646E68。'],
  ['调色板 / 设备','钢蓝 #60747B；苔绿 #707B62；锈红 #9D5345；旧金 #D3AD56。'],
  ['调色板 / 状态','告警 #D45B50；恐慌 #9B7AAF；青色 #8AB6B2；苍白蓝 #A2C3CA。颜色仅作既有状态表达，不引入数值规则。'],
];
spec.getRange(`A4:B${3+specification.length}`).values=specification;
specification.forEach((row,i)=>{
  const n=i+4;
  spec.getRange(`A${n}:B${n}`).format={fill:i%2?colors.pale:colors.white,rowHeightPx:calcHeight(row,[180,1030],11,170)};
  spec.getRange(`A${n}`).format={font:{...font,bold:true,color:colors.teal},fill:'#E8EFEB'};
});
spec.getRange('B8:B9').format.fill=colors.amber;
spec.freezePanes.freezeRows(3);

// Asset register: named production groups, acceptance, source, and editable status.
const widths=[95,65,125,330,210,160,520,340,235,290,120,80,260,440,125,340,250,380,420,440];
const last=7+all.length;
base(req,widths,last);
title(req,'网梗收容：奶龙失效｜美术素材需求','按当前实现与用户美术指南整理 · 先看「生成规范」，再按 P0 和依赖顺序生产', 'T');
req.getRange('A4').values=[['需求组']];req.getRange('D4').values=[['独立 PNG / 单姿势图']];req.getRange('G4').values=[['P0 生成需求组']];req.getRange('J4').values=[['程序保留组']];
req.getRange('B4').formulas=[[`=COUNTA(A8:A${last})`]];
req.getRange('E4').formulas=[[`=SUM(L8:L${last})`]];
req.getRange('H4').formulas=[[`=COUNTIFS(B8:B${last},"P0",L8:L${last},">0")`]];
req.getRange('K4').formulas=[[`=COUNTIF(L8:L${last},0)`]];
req.getRange('A4:K4').format={fill:'#E8EFEB',font:{...font,bold:true},rowHeightPx:34};
req.getRange('A5').values=[['查看列 D–H 获取命名、要求和参考对象；O 列为可填写进度。详细导出/轴点/来源见右侧列。']];
req.getRange('A5:T5').format={wrapText:false,font:{...font,color:colors.muted},rowHeightPx:30};
header(req,7,['需求ID','优先级','素材类别','素材命名（组）','中文名称','状态 / 用途','素材生成要求','素材参考对象 / 借鉴点','参考图ID','建议生成画布','交付类型','文件数','前置需求ID','策划 / 美术验收','生产状态（填写）','导出 / 后处理','轴点 / 对齐','当前实现来源','特有禁止项','备注 / 复用说明']);
const mainRows=all.map(a=>[a.id,a.priority,a.category,a.name,a.displayName,a.state,a.requirements,a.referenceObject,clean(a.referenceIds),a.canvas,a.deliveryType,a.quantity,clean(a.dependsOn)||'—',a.acceptance,a.quantity===0?'程序保留':'待生成',a.export,a.pivot,a.source,a.negative,a.notes]);
req.getRange(`A8:T${last}`).values=mainRows;
table(req,7,last,20,'AssetBrief');
mainRows.forEach((row,i)=>req.getRange(`A${i+8}:T${i+8}`).format.rowHeightPx=calcHeight(row,widths,10,450));
req.getRange(`O8:O${last}`).format.fill=colors.amber;
req.getRange(`O8:O${last}`).dataValidation={rule:{type:'list',values:['待生成','生成中','待筛选','待拆件','待接入','已验收','程序保留']}};
req.getRange(`B8:B${last}`).dataValidation={rule:{type:'list',values:['P0','P1','P2']}};
req.getRange(`B8:B${last}`).conditionalFormats.add('containsText',{text:'P0',format:{fill:'#E4EEE8',font:{color:'#205B42',bold:true}}});
req.getRange(`L8:L${last}`).setNumberFormat('0');
const rowFor=new Map(all.map((a,i)=>[a.id,i+8]));

// Per-file copyable prompts. Each formula follows the edited source requirements.
const pw=[100,415,240,1250,510,240,75,290,480,420,270,360,125,250];
const pend=units.length+7;
base(prompts,pw,pend);
title(prompts,'逐张提示词｜一行一张独立素材','复制 D 列完整提示词，并附上 F 列对应参考图；拆件先附已确认的本组定稿图，勿直接批量生成全套', 'N');
prompts.getRange('A4').values=[['出图任务']];prompts.getRange('B4').formulas=[[`=COUNTA(B8:B${pend})`]];
prompts.getRange('D4').values=[['提示词随主表要求与「生成规范」统一风格更新；建议先试做一名员工 + 奶龙平静/失效，再批量。']];
prompts.getRange('A4:N4').format={fill:'#E8EFEB',rowHeightPx:42,verticalAlignment:'center'};
prompts.getRange('A5').values=[['参考图在本工作簿内。回传目录是建议生产目录，不是当前游戏自动加载路径。每次仅处理一行。']];
prompts.getRange('A5:N5').format={wrapText:false,font:{...font,color:colors.muted},rowHeightPx:30};
header(prompts,7,['需求ID','单件文件名','本张生成对象','完整生成提示词（复制本格）','负面要求（也已含于提示词）','参考图ID','优先级','本张画布','本张范围 / 只画此件','输出与后处理','轴点 / 对齐','建议回传目录','出图状态（填写）','前置需求ID']);
const promptValues=units.map(u=>[u.a.id,u.filename,u.displayName,'','',clean(u.a.referenceIds),'',u.canvas,u.focus,u.unitExport,u.a.pivot,u.folder,'待生成',clean(u.a.dependsOn)||'—']);
prompts.getRange(`A8:N${pend}`).values=promptValues;
const fullFormulas=[];
const negFormulas=[];
const priorityFormulas=[];
for(let i=0;i<units.length;i++){
  const u=units[i],r=i+8,m=rowFor.get(u.a.id);
  negFormulas.push([`='生成规范'!$B$9&CHAR(10)&'素材需求'!S${m}`]);
  priorityFormulas.push([`='素材需求'!B${m}`]);
  fullFormulas.push([`="【唯一交付文件】"&B${r}&CHAR(10)&"【对象】"&C${r}&CHAR(10)&'生成规范'!$B$8&CHAR(10)&"【同组设计标准，仅作一致性约束】"&'素材需求'!G${m}&CHAR(10)&"【本次只画】"&I${r}&"；本次只交付这一件/一个姿势，不把同组其他素材、姿势或裁切线画进本图，不拼成多格图集。"&CHAR(10)&"【状态】"&'素材需求'!F${m}&CHAR(10)&"【参考】附图 "&F${r}&"。"&'素材需求'!H${m}&"。如有前置定稿，必须保持同一造型、比例、线宽、服装和配色；拆件需另附已确认整身定稿图。"&CHAR(10)&"【画布】"&H${r}&"；尺寸不支持时保持比例生成，再后处理到目标尺寸。"&CHAR(10)&"【输出】"&J${r}&"。只输出当前这一张；套组其余部分由其他任务分别完成。透明须为真实Alpha，禁止棋盘格。"&CHAR(10)&"【对齐】"&K${r}&CHAR(10)&"【禁止】"&E${r}`]);
}
prompts.getRange(`D8:D${pend}`).formulas=fullFormulas;
prompts.getRange(`E8:E${pend}`).formulas=negFormulas;
prompts.getRange(`G8:G${pend}`).formulas=priorityFormulas;
table(prompts,7,pend,14,'GenerationTasks');
prompts.freezePanes.freezeColumns(3);
for(let i=0;i<units.length;i++){
  const u=units[i];
  const estimate=specification[4][1]+u.a.requirements+u.focus+u.a.referenceObject+u.canvas+u.a.export+u.a.pivot+specification[5][1]+u.a.negative+'\n'.repeat(12)+' '.repeat(180);
  const vals=[...promptValues[i]];vals[3]=estimate;vals[4]=specification[5][1]+u.a.negative;
  prompts.getRange(`A${i+8}:N${i+8}`).format.rowHeightPx=calcHeight(vals,pw,10,540);
}
prompts.getRange(`M8:M${pend}`).format.fill=colors.amber;
prompts.getRange(`M8:M${pend}`).dataValidation={rule:{type:'list',values:['待生成','生成中','待筛选','待清理','待接入','已验收']}};

// Embedded references: actual gameplay screenshots, never concept mockups.
const refRows=references.length*31+7;
base(refs,[180,180,180,180,180,180],refRows);
title(refs,'参考图｜当前游戏实机素材索引','截图来源：本项目 2026-10-20 实机证据；仅作形态/空间参考，最终画风以「生成规范」和逐项要求为准', 'F');
refs.getRange('A4').values=[['使用方法：找到提示词中的 REF 编号；提取/复制对应图片给图像模型，再附上已确认的本批定稿图。']];
refs.getRange('A4:F4').format={wrapText:false,rowHeightPx:32,font:{...font,color:colors.muted}};
for(let i=0;i<references.length;i++){
  const ref=references[i],r=7+i*31;
  refs.getRange(`A${r}:F${r}`).format={fill:colors.teal,font:{...font,bold:true,color:colors.white},rowHeightPx:32,wrapText:false};
  refs.getRange(`A${r}`).values=[[ref.id+'  ｜  '+ref.name]];
  const caption=[...ref.use];
  refs.getRange(`A${r+1}`).values=[[caption.slice(0,73).join('')]];
  refs.getRange(`A${r+2}`).values=[[caption.slice(73).join('')]];
  refs.getRange(`A${r+1}:F${r+1}`).format={wrapText:false,font:{...font,color:colors.muted},rowHeightPx:32};
  refs.getRange(`A${r+2}:F${r+2}`).format={wrapText:false,font:{...font,color:colors.muted},rowHeightPx:24};
  refs.getRange(`A${r+3}`).values=[['实机来源：'+ref.file]];
  refs.getRange(`A${r+3}:F${r+3}`).format={wrapText:false,font:{...font,size:9,color:colors.muted}};
  const data=await fs.readFile(path.join(root,ref.file));
  refs.images.add({dataUrl:'data:image/png;base64,'+data.toString('base64'),anchor:{from:{row:r+4,col:0},extent:{widthPx:1066,heightPx:600}}});
}
refs.freezePanes.freezeRows(4);

wb.recalculate();
const summary={requirements:all.length,files:units.length,procedural:all.filter(a=>a.quantity===0).length,p0:all.filter(a=>a.priority==='P0'&&a.quantity>0).length,referenceImages:references.length,sheets:4};
const countValues=req.getRange('A4:K4').values[0];
if(countValues[1]!==summary.requirements||countValues[4]!==summary.files||countValues[7]!==summary.p0||countValues[10]!==summary.procedural)throw new Error('Summary formula mismatch '+JSON.stringify(countValues));
const promptText=prompts.getRange(`D8:D${pend}`).values.map(r=>r[0]);
if(promptText.some(t=>typeof t!=='string'||!t.includes('【唯一交付文件】')||!t.includes('【禁止】')))throw new Error('Missing prompt output');
if(promptText.some(t=>t.length>32767))throw new Error('Prompt exceeds Excel cell limit');
promptText.forEach((t,i)=>{const vals=[...promptValues[i]];vals[3]=t;vals[4]=prompts.getRange(`E${i+8}`).values[0][0];prompts.getRange(`A${i+8}:N${i+8}`).format.rowHeightPx=calcHeight(vals,pw,10,540);});
await fs.mkdir(outDir,{recursive:true});
await fs.writeFile(path.join(work,'validation.json'),JSON.stringify({...summary,maxPromptLength:Math.max(...promptText.map(t=>t.length)),counts:countValues},null,2));
const check=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!',options:{useRegex:true,maxResults:20},maxChars:2000});
console.log('FORMULA_CHECK',JSON.stringify(check));
for(const [sheetName,range,name] of [
  ['素材需求','A1:H11','preview-requirements.png'],
  ['素材需求','M7:T10','preview-acceptance.png'],
  ['逐张提示词','A1:D9','preview-prompts.png'],
  ['生成规范','A1:B12','preview-spec.png'],
  ['参考图','A1:F35','preview-references.png'],
  ['参考图','A441:F470','preview-references-last.png'],
]){
  const p=await wb.render({sheetName,range,scale:1,format:'png'});
  await fs.writeFile(path.join(work,name),new Uint8Array(await p.arrayBuffer()));
}
const xlsx=await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(outfile);
console.log(JSON.stringify({outfile,...summary,maxPromptLength:Math.max(...promptText.map(t=>t.length))}));
