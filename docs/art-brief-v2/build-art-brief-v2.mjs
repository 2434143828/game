import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const work = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(work, '../..');
const outDir = path.join(root, 'outputs/01a144a7-9b8e-7ec0-91c1-cb1e9446d500');
const outfile = path.join(outDir, '网梗收容_美术素材需求_v2.0_现代新媒体_20261021.xlsx');
const read = async name => JSON.parse((await fs.readFile(path.join(work, name), 'utf8')).replace(/^\uFEFF/, ''));
const files = ['characters-v2.json', 'environment-v2.json', 'ui-vfx-v2.json', 'program-v2.json'];
const inputs = await Promise.all(files.map(read));
const groups = inputs.slice(0, 3).flat();
const programs = inputs[3];
for (const a of [...groups,...programs]) a.priority=({P0:'P0常态',P1:'P1局部污染',P2:'P2扩展演出'})[a.priority]??a.priority;
groups.sort((a,b) => a.priority.localeCompare(b.priority));
const text = value => Array.isArray(value) ? value.join('；') : String(value ?? '');
const required = ['id','priority','module','name','displayName','requirements','reference','size','format','pivot','negative','trigger','migration','acceptance','deliveryType'];
for (const a of groups) {
  for (const key of required) if (!text(a[key])) throw new Error('Missing '+key+' in '+a.id);
  if (!/^[a-z0-9_]+$/.test(a.name) || !a.name.includes('nm_v2')) throw new Error('Invalid versioned name '+a.name);
  if (a.quantity !== a.units.length || !a.quantity) throw new Error('Quantity mismatch '+a.id);
}
if (new Set(groups.map(a=>a.id)).size !== groups.length) throw new Error('Duplicate IDs');
const units = groups.flatMap(a=>a.units.map(u=>({
  ...u, a, filename:a.name+(u.suffix?'_'+u.suffix:'')+'.png',
  type: /参考|定稿/.test(a.deliveryType) ? '定稿／动作参考' : '游戏拆件／贴图',
  folder: 'art_delivery/nm_v2/'+(/参考|定稿/.test(a.deliveryType)?'references':a.name.includes('_env_')?'environment':a.name.includes('_ui_')?'ui':/^nm_v2_(vfx|poll|show)_/.test(a.name)?'vfx':/装备|武器|防具/.test(a.module)?'equipment':/收容物|异常/.test(a.module)?'abnormalities':'characters')+'/'
})));
if (new Set(units.map(u=>u.filename)).size !== units.length) throw new Error('Duplicate filenames');
const counts = {groups:groups.length, pngs:units.length, runtime:units.filter(u=>u.type==='游戏拆件／贴图').length, reference:units.filter(u=>u.type==='定稿／动作参考').length, program:programs.length};
for (const p of ['P0常态','P1局部污染','P2扩展演出']) counts[p]=units.filter(u=>u.a.priority===p).length;
const wb = Workbook.create();
const main = wb.worksheets.add('素材需求');
const prompts = wb.worksheets.add('逐张提示词');
const spec = wb.worksheets.add('生成规范');
const integration = wb.worksheets.add('程序与动效');
const acceptance = wb.worksheets.add('验收清单');
const C={ink:'#1E2630',blue:'#237BAD',line:'#D9E1EA',muted:'#607080',pale:'#F3F7FA',white:'#FFFFFF',amber:'#FFF3D6'};
const font={name:'Microsoft YaHei',size:10,color:C.ink};
function col(n){let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function init(sh,widths,rows,title,subtitle){
  sh.showGridLines=false;sh.tabColor=C.blue;
  const area=sh.getRange(`A1:${col(widths.length)}${rows}`);
  area.format={font,fill:C.white,wrapText:true,verticalAlignment:'top',rowHeightPx:26};
  widths.forEach((w,i)=>sh.getRange(`${col(i+1)}1:${col(i+1)}${rows}`).format.columnWidthPx=w);
  sh.getRange('A2').values=[[title]];
  sh.getRange(`A2:${col(widths.length)}2`).format={font:{...font,size:16,bold:true},wrapText:false,rowHeightPx:36,borders:{bottom:{style:'thin',color:C.line}}};
  sh.getRange('A3').values=[[subtitle]];
  sh.getRange(`A3:${col(widths.length)}3`).format={font:{...font,color:C.muted},wrapText:false,rowHeightPx:30};
}
function header(sh,row,labels){
  sh.getRange(`A${row}:${col(labels.length)}${row}`).values=[labels];
  sh.getRange(`A${row}:${col(labels.length)}${row}`).format={fill:C.ink,font:{...font,bold:true,color:C.white},horizontalAlignment:'center',verticalAlignment:'center',rowHeightPx:38};
}
function height(values,widths,min=62){
  let lines=1;
  values.forEach((v,i)=>{const w=Math.max(5,(widths[i]-18)/13.34);const l=text(v).split('\n').reduce((n,s)=>n+Math.max(1,Math.ceil([...s].reduce((sum,ch)=>sum+(ch.charCodeAt(0)>255?1:.55),0)/w)),0);lines=Math.max(lines,l);});
  const h=Math.max(min,lines*19+20);if(h>535) throw new Error('Row would clip '+h+' '+text(values[0]));return h;
}
function dataTable(sh,row,labels,rows,widths,name,freeze=2){
  header(sh,row,labels);const end=row+rows.length;
  if(rows.length)sh.getRange(`A${row+1}:${col(labels.length)}${end}`).values=rows;
  sh.tables.add(`A${row}:${col(labels.length)}${end}`,true,name).showFilterButton=true;
  rows.forEach((values,i)=>sh.getRange(`A${row+i+1}:${col(labels.length)}${row+i+1}`).format={fill:i%2?C.pale:C.white,rowHeightPx:height(values,widths),borders:{bottom:{style:'thin',color:C.line}}});
  sh.freezePanes.freezeRows(row);sh.freezePanes.freezeColumns(freeze);
}
function priorityStyle(range){for(const [p,fill,color] of [['P0','#E9F5FC','#1C6494'],['P1','#FFF0DB','#9A5D0E'],['P2','#F0EAFB','#745199']])range.conditionalFormats.add('containsText',{text:p,format:{fill,font:{color,bold:true}}});}

// The shared style and production contract own all reusable prompt inputs.
const specifications=[
 ['使用顺序','先按「素材需求」P0筛选：定稿→拆件→常态动作与设施/UI；常态验收后做P1五物局部污染，最后做P2升级演出。复制「逐张提示词」D列整段，一次只生成一张。'],
 ['统计口径','素材需求一行一组；逐张提示词一行一张PNG。定稿/动作参考与游戏拆件分别计数，参考图不能直接当动画。程序与动效的数量均为0，不计入PNG。'],
 ['交付现状','本版是新版美术生产需求，所有素材待生成、待验收、待接入；旧版已存在的图片和测试结果不能当作本版完成证明。本次Excel不会修改游戏素材或代码。'],
 ['统一风格提示词','原创2D横版设施模拟经营游戏美术。常态为现代新媒体收容机构：干净、舒适、清晰的数字科研环境，轻科幻、清洁工业、克制轮廓与简洁色块，低纹理噪声；员工有头、身体、手脚，2.5至3头身，现代科研/管理工作装。异常仅使用互联网平台评论、推荐、直播、通知与压缩故障的局部污染视觉；荒诞但保留原对象辨识度。设施和人物正交侧视，UI正视平面。'],
 ['统一负面提示词','不要旧厂房、重锈蚀、脏污铁皮、纸质旧档案、地牢监狱、柴油朋克、军工地下基地、赛博城市霓虹；不要粗墨纸纹怪诞童话基调、裂嘴空眼和统一恐怖怪物化；不要冷酷特工、写实士兵、纯玩偶员工；不要魔法爆炸、全屏红闪、局部高频闪屏、整屏抖动；不要烘焙文字、数字、Logo、水印、血条、进度、路径、范围、棋盘格或整套游戏界面。'],
 ['常态基础色','深灰黑 #12161C；蓝灰 #1E2630；金属灰 #39424E；冷白 #D9E1EA；冷青蓝 #57B8FF。建筑/制服/UI以此为骨架，保留亮面与空间层次，不做压抑黑洞。'],
 ['局部污染色','荧光粉 #FF4FA3；亮紫 #9C6BFF；明黄 #FFD84D；亮橙 #FF8A3D；异常红 #FF5B6E；霓虹蓝 #4EDBFF。跟随五物母题局部点缀，禁止整张常态设施被荧光占满。'],
 ['单张生成规则','只生成本张限定对象的一张独立PNG，不生成拼贴、联系表、多姿势、多视角或含多个独立零件的大图。优先附上同角色已批准的v2定稿；未定稿先做定稿，不能混用其他角色的脸或旧版恐怖形态。'],
 ['技术规格边界','表内尺寸、轴点、拆件方式、缩放检查和动效限制均为建议制作规格，需接入时校准；不是新增玩法数值。模型不支持目标尺寸时先同宽高比生成，再由后处理调整尺寸/真实Alpha/轴点/拼接。模型不直接交付PSD、骨骼数据或可运行动画。'],
 ['参考与资产区别','定稿图用于确认风格；动作参考是单姿势/关键姿态，供程序骨骼/补间复现。游戏拆件保持母版画布、连接点与统一比例，不自动紧裁；PNG中的像素、碰撞和模拟结算不能各用一套状态。'],
 ['文字与数值','图片只交付空白面板、气泡、框和图形符号，中文/数字由程序渲染。观看人数、点赞数、安抚值当前无业务字段，不新增指标、不伪造实时读数；可用非数字装饰表达氛围。已有HP/SP、日目标、冷却等只读真实状态。'],
 ['人员与动作','安全员、研究员、技术员、医疗员仅外观差异，不新增职业数值/治疗技能。必须覆盖待机、行走、到位、工作、攻击、受击、惊慌、撤退、恢复、技能反馈，以及现有攀爬/倒地。动作不负责产能或伤害结算。'],
 ['五物身份','N01 奶龙：暖黄奶白、低龄内容、重复自我复制；N02 耄耋：暖灰脏粉、情绪评论；N03 大狗：红橙粉白、直播打call；N04 叮咚鸡：明黄橙黄、通知循环播报；N05 咕咕嘎嘎：浅蓝粉白、幼态噪声与软弹气泡。仅这五种。'],
 ['80% / 20%','80%常态、20%异常是整体视觉主次和体验目标，不是固定计时、概率、强制屏幕面积或新数值。具体遮挡面积/时长在接入阶段调优，先保证常态舒适和关键信息清晰。'],
 ['污染层与P2','常态动效稳定、低频、平滑；异常用短时插入、重复、轻微错位，禁止局部或全屏高频闪烁。污染是覆盖层，基础UI仍可读、可操作，覆盖层不吞鼠标。局部→整层升级与现有技能/联动事件同步，只扩展演出层级；不增加传播网络、外部热度、科研、自动预案或新异常。'],
 ['命名与交付','新资源统一含nm_v2；单张命名见提示词A列；建议交到art_delivery/nm_v2/相应子目录，保留旧资源。该目录是交付建议，并非已注册加载器路径。接入时建立清单、真实尺寸、轴点与图层映射，验收后逐项切换。'],
 ['新增与复用','复用真实实体、路径、工作位、战斗、暂停、存档与已配置装备/技能。四职业、现代门禁/维护/补给道具及污染层是本版外观需求，新增摆件需另做场景挂点，不代表已接入或新增可操作房间功能。'],
 ['旧版迁移','上一版粗墨线、纸纹、锈蚀和恐怖变形不作为正向参考。既有图只可参考空间连接、实体身份、动作时序与拆件接口；本版素材要求和参考对象在主表逐项重写。旧ID可追溯但不等于原PNG可直接复用。'],
 ['来源及优先级','最高来源：用户2026-10-21附《美术总方案》，第1—9节。实现边界：项目AGENTS.md v0.2、CODEX_START.md、docs/00_产品形态与视觉验收.md、config/与contracts/data-contract.ts。资源盘点：art-production/production-index.json及上一版需求表；仅用于迁移，不继承旧风格。'],
 ['导出与操作提示','主表按ID关联单张提示词，调整生成要求/参考/命名前缀会更新提示词；新增/删除单张行会影响数量，需同时维护完整单张列表。优先级和制作状态可筛选。先批准定稿再批量出同角色拆件，避免模型跨批次换形。'],
 ['程序字体规范','主系统使用现代、中性中文无衬线字体，小字号中文和数字清晰；污染文字可以更活泼，但仍须易读。禁止大面积古典字、厚重标题字、综艺营销字与花哨二次元字泛滥。字体由程序排版加载，不能作为图片内烘焙文字交付。'],
];
init(spec,[210,1120],43,'生成规范｜现代新媒体收容机构','v2.0 · 2026-10-21 · 本页为统一风格与技术输入，生成提示词自动引用');
header(spec,4,['规范项','执行标准']);
specifications.forEach(([key,value],i)=>{const r=i+5;spec.getRange(`A${r}:B${r}`).values=[[key,value]];spec.getRange(`A${r}:B${r}`).format={fill:i%2?C.pale:C.white,rowHeightPx:height([key,value],[210,1120],60)};spec.getRange(`A${r}`).format.font={...font,bold:true};});
spec.freezePanes.freezeRows(4);spec.freezePanes.freezeColumns(1);
header(spec,27,['色值','用途／色板（颜色来自本次用户规范）']);
[['#12161C','常态 · 深灰黑'],['#1E2630','常态 · 蓝灰'],['#39424E','常态 · 金属灰'],['#D9E1EA','常态 · 冷白'],['#57B8FF','常态 · 冷青蓝'],['#FF4FA3','污染 · 荧光粉'],['#9C6BFF','污染 · 亮紫'],['#FFD84D','污染 · 明黄'],['#FF8A3D','污染 · 亮橙'],['#FF5B6E','污染 · 异常红'],['#4EDBFF','污染 · 霓虹蓝']].forEach(([hex,desc],i)=>{const r=28+i;spec.getRange(`A${r}:B${r}`).values=[[hex,desc]];spec.getRange(`A${r}`).format={fill:hex,font:{...font,bold:true,color:i<3?'#FFFFFF':'#12161C'}};spec.getRange(`A${r}:B${r}`).format.rowHeightPx=32;});

const mh=['需求ID','优先级','模块','素材命名前缀','素材对象','素材生成要求','素材参考对象','PNG张数','交付性质','常态／异常状态','建议尺寸','交付格式','轴点／拼接建议','本组禁止项','实际状态与触发','旧版如何替换','验收标准','制作现状','旧版需求ID'];
const mw=[120,110,130,300,180,540,320,80,170,160,160,220,330,370,420,400,410,140,160];
const mr=groups.map(a=>[a.id,a.priority,a.module,a.name,a.displayName,a.requirements,a.reference,a.quantity,a.deliveryType,a.state,a.size,a.format,a.pivot,a.negative,a.trigger,a.migration,a.acceptance,'待生成／待接入',text(a.oldIds)].map(text));
init(main,mw,mr.length+9,'网梗收容：奶龙失效｜美术素材需求 v2.0','常态：现代新媒体收容机构　｜　异常：平台污染型互联网失效视觉');
dataTable(main,7,mh,mr,mw,'ArtRequirementsV2',3);
const lastM=groups.length+7,lastU=units.length+7;
main.getRange('A4').formulas=[[`="需求 "&COUNTA(A8:A${lastM})&" 组  ·  PNG "&SUM(H8:H${lastM})&" 张  ·  P0 "&SUMIF(B8:B${lastM},"P0常态",H8:H${lastM})&" 张  ·  P1 "&SUMIF(B8:B${lastM},"P1局部污染",H8:H${lastM})&" 张  ·  P2 "&SUMIF(B8:B${lastM},"P2扩展演出",H8:H${lastM})&" 张"`]];
main.getRange('A5').values=[['阅读顺序：生成规范 → 本表按优先级筛选 → 逐张提示词 D 列复制给 image 模型；先定稿，再出拆件与动作参考。']];
main.getRange('A4:S5').format={wrapText:false,rowHeightPx:29};
main.getRange('A4').format.font={...font,bold:true,color:C.blue};
main.getRange(`H8:H${lastM}`).formulas=groups.map((a,i)=>[`=COUNTIF('逐张提示词'!$B$8:$B$${lastU},A${i+8})`]);
main.getRange(`H8:H${lastM}`).setNumberFormat('0');main.getRange(`H8:H${lastM}`).format.horizontalAlignment='right';
priorityStyle(main.getRange(`B8:B${lastM}`));

const ph=['单张文件名','需求ID','本张对象','完整生成提示词｜复制本列','本张限定范围｜可修改','素材参考对象','优先级','交付用途','建议画布／格式','交付目录（建议）','制作状态','文件后缀'];
const pw=[340,120,200,1180,480,330,110,170,260,300,120,170];
const pr=units.map(u=>[u.filename,u.a.id,u.displayName,'',u.focus,u.a.reference,u.a.priority,u.type,text(u.size??u.a.size)+'；'+text(u.format??u.a.format),u.folder,'待生成',u.suffix??'']);
init(prompts,pw,units.length+9,'逐张提示词｜一行一张 PNG','D 列已合并统一风格、单张范围、规格、参考与禁止项；不要一次要求模型生成整组');
dataTable(prompts,7,ph,pr,pw,'ArtPromptsV2',2);
prompts.getRange('A4').formulas=[[`="共 "&COUNTA(B8:B${lastU})&" 张 · 游戏拆件/贴图 "&COUNTIF(H8:H${lastU},"游戏拆件／贴图")&" 张 · 定稿/动作参考 "&COUNTIF(H8:H${lastU},"定稿／动作参考")&" 张"`]];
prompts.getRange('A5').values=[['先出同对象定稿，批准后附上定稿生成拆件。尺寸修正、去底、分层、轴点和实际动画由后处理与程序接入完成。']];
prompts.getRange('A4:L5').format={wrapText:false,rowHeightPx:29};prompts.getRange('A4').format.font={...font,bold:true,color:C.blue};
const lookup=(letter,r)=>`INDEX('素材需求'!$${letter}$8:$${letter}$${lastM},MATCH(B${r},'素材需求'!$A$8:$A$${lastM},0))`;
const formulas=[];
units.forEach((u,i)=>{
 const r=i+8;
 prompts.getRange(`A${r}`).formulas=[[`=${lookup('D',r)}&IF(L${r}="","","_"&L${r})&".png"`]];
 prompts.getRange(`F${r}:G${r}`).formulas=[[`=${lookup('G',r)}`,`=${lookup('B',r)}`]];
 formulas.push([`="【交付文件】"&A${r}&CHAR(10)&"【本张任务】"&C${r}&CHAR(10)&'生成规范'!$B$8&CHAR(10)&"【单张范围】"&E${r}&CHAR(10)&"【本组造型约束】"&${lookup('F',r)}&CHAR(10)&"【参考对象】"&F${r}&CHAR(10)&"【制作规格】"&I${r}&"；"&${lookup('M',r)}&CHAR(10)&"【颜色】"&'生成规范'!$B$10&"；"&'生成规范'!$B$11&CHAR(10)&"【输出规则】"&'生成规范'!$B$12&" 后处理对齐尺寸与轴点；交付用途："&H${r}&CHAR(10)&"【禁止项】"&'生成规范'!$B$9&"；"&${lookup('N',r)}`]);
});
prompts.getRange(`D8:D${lastU}`).formulas=formulas;
priorityStyle(prompts.getRange(`G8:G${lastU}`));
prompts.getRange(`K8:K${lastU}`).format.fill=C.amber;
prompts.getRange(`K8:K${lastU}`).dataValidation={rule:{type:'list',values:['待生成','已生成','需返工','已验收']}};

const ih=['职责ID','优先级','程序／动效职责','呈现要求','真实触发／数据来源','与图片分工','验收标准','当前状态'];
const iw=[140,110,210,520,440,430,460,140];
const ir=programs.map(a=>[a.id,a.priority,a.displayName,a.requirements,a.trigger,a.migration,a.acceptance,'待接入验收']);
init(integration,iw,ir.length+9,'程序与动效｜无需向模型索取 PNG','本页计图数为 0；真实路径、数值、文字、状态、插值和污染时序由程序负责');
integration.getRange('A4').values=[['复用现有模拟；新增外观与污染层待接入。暂停冻结移动、工作、攻击及其表现，暂停期间改令在恢复后执行。']];
integration.getRange('A4:H4').format.wrapText=false;
dataTable(integration,7,ih,ir,iw,'ArtIntegrationV2',1);priorityStyle(integration.getRange(`B8:B${ir.length+7}`));

const checks=[
 ['A01','定稿','常态风格','设施、角色与主UI呈现干净、现代、清晰的新媒体研究机构；不依靠旧锈铁、纸档案或粗墨线表现收容感。','对比新版色板、角色与房间定稿。'],
 ['A02','定稿','五物辨识','N01暖黄奶白；N02暖灰脏粉；N03红橙粉白；N04明黄橙黄；N05浅蓝粉白；失效以重复/评论/直播/播报/幼态噪声区分。','并排看五物常态与失效定稿。'],
 ['A03','定稿','员工比例和职业','2.5—3头身，头身手脚明确；安全/研究/技术/医疗四外观可辨；研究员舒服理性，不像士兵或特工。','定稿与实际默认缩放均检查。'],
 ['A04','出图','单件可交付','一行一PNG，数量、命名、比例和版本一致；透明素材有真实Alpha，不是棋盘格/白底假透明。','按逐张列表逐一核对文件及Alpha。'],
 ['A05','出图','拆件装配','同角色母版画布/轴点/关节一致，双臂腿与手持装备可接合，翻转不改变人体比例；拆件无缺口和脏边。','叠层装配、镜像与工作/攻击关键姿态检查。'],
 ['A06','出图与实机','文字分离与字体','图片无烘焙中文、数值、血条、计时或状态；程序主字体为现代中文无衬线，小字号及数字清晰，污染文字活泼但易读。','逐图放大检查后叠真实文本；禁止古典/营销/花哨字泛滥。'],
 ['A07','出图','模块拼接','墙地板边缘平铺无明显接缝；门、窗、楼梯、终端及工作位有清楚空间关系。','连续拼接至少三段；不拿整张概念场景替换关卡。'],
 ['A08','出图','旧版清退','旧图只留作身份/接口参考；不残留裂嘴空眼、巨大恐怖口、旧挂钟纸柜或冰霜房的正向要求。','按主表旧版如何替换逐组检查。'],
 ['A09','实机','设施主体','默认画面设施约65%以上；真实多层剖面、房间和通道可辨，UI不挤占空间，不把文字卡片当主场景。','运行游戏截图，覆盖总览与局部缩放。'],
 ['A10','实机','人员调度','小人可点选/框选并连续移动，途中改令；走入收容室到工作位才工作；姿态与实际实体位置一致。','连续记录：移动途中改令→进室到位→工作。'],
 ['A11','实机','工作与战斗动作','待机/走路/攀爬/到位/工作/攻击/命中/受击/惊慌/撤退/倒地/恢复/技能反馈完整；动画参考不当作已接入动画。','真实失效→进入射程→出手命中→受击→撤退。'],
 ['A12','实机','污染可读性与节奏','常态稳定低频平滑，禁止局部/全屏高频闪烁。污染是局部短时覆盖层且不吞鼠标；人员/异常位置、房间编号状态、HP/SP、技能可用和日目标始终可辨。','五物分别失效；实际点击被覆盖区域仍可操作。'],
 ['A13','实机','五物污染差异','N01重复黄气泡；N02争吵情绪；N03爱心直播；N04通知波形；N05软弹拟声；保留常态背景与基础UI。','五物分别录制一段，逐项对照母题。'],
 ['A14','实机','统一状态与暂停','画面/位置/工作/伤害绑定同一模拟；暂停冻结实体和对应特效，暂停改令后恢复执行新命令。','比较暂停前后位置、工作进度、HP/SP、角色姿态、攻击相位与污染粒子/相位均不推进；选择及按钮悬停可响应。'],
 ['A15','实机','不新增玩法或假读数','职业仅外观；P2仅演出；不存在新热度/传播网/安抚值/治疗职业；观看点赞无数据则不显示数值。','检查代码映射与UI实际数值来源。'],
 ['A16','实机','五物装备技能与兼容','沿用五物、五武器/防具与五技能ID，装备仅四属性；旧存档与正式第一日原四员工配置保持可用。','接入后运行类型检查、测试、构建和真实场景验证。'],
 ['A17','实机','证据与完成口径','截图/连续操作来自真实游戏；出图完成、接入完成与实机通过分开记录；无法运行明确未验证。','保留运行版本、截图和操作记录，禁止生成假实机图。'],
];
const aw=[90,100,170,680,500,120,400];
init(acceptance,aw,checks.length+9,'验收清单｜出图合格与实机合格分开记录','当前全部待验收；本次只交需求表，不以旧版验收结果替代新版视觉验证');
dataTable(acceptance,7,['验收ID','阶段','检查对象','通过标准','检查方法','验收结果','证据／返工备注'],checks.map(c=>[...c,'待验收','']),aw,'ArtAcceptanceV2',2);
acceptance.getRange(`F8:G${checks.length+7}`).format.fill=C.amber;
acceptance.getRange(`F8:F${checks.length+7}`).dataValidation={rule:{type:'list',values:['待验收','通过','需返工','未验证']}};

wb.recalculate();
// Check live linkage using an ordinary edit, then restore before export.
const original=spec.getRange('B8').values[0][0];
spec.getRange('B8').values=[[original+' TEST_LINK_V2']];wb.recalculate();
for(const r of [8,lastU])if(!String(prompts.getRange(`D${r}`).values[0][0]).includes('TEST_LINK_V2'))throw new Error('Prompt does not respond to style input');
spec.getRange('B8').values=[[original]];wb.recalculate();
for(let i=0;i<groups.length;i++)if(Number(main.getRange(`H${i+8}`).values[0][0])!==groups[i].quantity)throw new Error('Live quantity mismatch '+groups[i].id);
for(let i=0;i<units.length;i++){
 const r=i+8,vals=prompts.getRange(`A${r}:L${r}`).values[0];
 if(vals[0]!==units[i].filename)throw new Error('Filename formula mismatch '+units[i].a.id);
 if(!String(vals[3]).includes(units[i].focus)||String(vals[3]).includes('TEST_LINK_V2'))throw new Error('Bad prompt '+r);
 prompts.getRange(`A${r}:L${r}`).format.rowHeightPx=height(vals,pw,285);
}
wb.recalculate();
await fs.mkdir(outDir,{recursive:true});
const inspected=await wb.inspect({kind:'region',sheetId:'素材需求',range:'A4:H9',maxChars:2400,tableMaxRows:6,tableMaxCols:8,tableMaxCellChars:90});
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#N/A|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:30},maxChars:2500});
await fs.writeFile(path.join(work,'inspection.json'),JSON.stringify({counts,inspected,errors},null,2));
const renderJobs=[['素材需求','A1:H10','01-requirements'],['逐张提示词','A7:D9','02-prompts'],['生成规范','A1:B12','03-spec'],['生成规范','A27:B38','04-palette'],['程序与动效','A1:F10','05-program'],['验收清单','A1:F11','06-acceptance']];
for(const [sheetName,range,name]of renderJobs){const blob=await wb.render({sheetName,range,scale:1,format:'png'});await fs.writeFile(path.join(work,name+'.png'),new Uint8Array(await blob.arrayBuffer()));}
const output=await SpreadsheetFile.exportXlsx(wb);await output.save(outfile);
await fs.writeFile(path.join(work,'build-summary.json'),JSON.stringify({outfile,counts,files:units.map(u=>u.filename),formulaLinkTest:'PASS',quantityCheck:'PASS'},null,2));
console.log(JSON.stringify({outfile,counts,errors},null,2));
