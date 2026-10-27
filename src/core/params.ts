// Every tunable mechanism coefficient lives here, with a description, so experiments can vary them.

export interface Params {
  // Food and production
  foodNeedAdult: number;
  gatherRate: number;
  huntRate: number;
  fishRate: number;
  farmRate: number;
  herdRate: number;
  farmLabor: number;
  toolRate: number;
  clothesRate: number;
  foodDecay: number;
  abilityWeight: number;
  skillGain: number;
  toolBonus: number;
  plantRegen: number;
  gameRegen: number;
  // Labor and leisure (DESIGN.md §4.1)
  maxHours: number;
  fatigue: number;
  bufferDays: number;
  wealthStatus: number;
  generosity: number;
  leisureJoy: number;
  leisureResearch: number;
  // Reputation, monitoring and exclusion
  dunbar: number;
  // Territory
  forageRange: number;
  farmRange: number;
  herdRange: number;
  reciprocity: number;
  punishment: number;
  exileRep: number;
  exileMonths: number;
  outsiderRep: number;
  // Demography
  fertility: number;
  baseMortality: number;
  huntDanger: number;
  epidemicRate: number;
  epidemicLethality: number;
  starvationDamage: number;
  coldDamage: number;
  heritability: number;
  // Politics
  planNoise: number;
  corruption: number;
  reformMargin: number;
  revoltThreshold: number;
  baseReach: number;
  enforceThreshold: number;
  termYears: number;
  // Factions, suffrage, checks (DESIGN.md §13)
  factionEngagement: number;
  maxFactions: number;
  factionKin: number;
  factionIdentity: number;
  factionDiscipline: number;
  partyLoyalty: number;
  uncheckedCoup: number;
  impeachRate: number;
  checkedGraft: number;
  // Culture
  interestRate: number;
  conformRate: number;
  experienceRate: number;
  // Research
  lbdRate: number;
  researchRate: number;
  patronShare: number;
  // Diplomacy and war
  contactRange: number;
  warPropensity: number;
  campaignRange: number;
  casualtyRate: number;
  raidLoot: number;
  tributeRate: number;
  conquestMassacre: number;
  secession: number;
  vassalThreshold: number;
  vassalTribute: number;
  campaignDays: number;
  woundRate: number;
  // Cross-border trade, marriage and migration (DESIGN.md §12.9)
  tradeRange: number;
  tradeRate: number;
  marriageRange: number;
  intermarriage: number;
  kinPeace: number;
  emigration: number;
}

export const DEFAULT_PARAMS: Params = {
  foodNeedAdult: 1,
  gatherRate: 0.55,
  huntRate: 0.65,
  fishRate: 0.6,
  farmRate: 1.0,
  herdRate: 0.6,
  farmLabor: 12,
  toolRate: 0.03,
  clothesRate: 0.02,
  foodDecay: 0.01,
  abilityWeight: 0.5,
  skillGain: 0.0015,
  toolBonus: 0.4,
  plantRegen: 0.02,
  gameRegen: 0.012,
  maxHours: 12,
  fatigue: 0.09,
  bufferDays: 60,
  wealthStatus: 0.3,
  generosity: 0.3,
  leisureJoy: 0.2,
  leisureResearch: 0.03,
  dunbar: 150,
  forageRange: 2.5,
  farmRange: 1.2,
  herdRange: 3.5,
  reciprocity: 0.6,
  punishment: 0.8,
  exileRep: 0.45,
  exileMonths: 12,
  outsiderRep: 0.6,
  fertility: 0.3,
  baseMortality: 1,
  huntDanger: 0.012,
  epidemicRate: 0.01,
  epidemicLethality: 0.15,
  starvationDamage: 0.04,
  coldDamage: 0.02,
  heritability: 0.5,
  planNoise: 0.5,
  corruption: 0.08,
  reformMargin: 0.12,
  revoltThreshold: 0.5,
  baseReach: 8,
  enforceThreshold: 0.45,
  termYears: 10,
  factionEngagement: 0.4,
  maxFactions: 6,
  factionKin: 0.25,
  factionIdentity: 0.15,
  factionDiscipline: 0.5,
  partyLoyalty: 1.5,
  uncheckedCoup: 0.1,
  impeachRate: 0.5,
  checkedGraft: 0.5,
  interestRate: 0.012,
  conformRate: 0.02,
  experienceRate: 0.012,
  lbdRate: 0.0003,
  researchRate: 0.006,
  patronShare: 0.01,
  contactRange: 8,
  warPropensity: 1,
  campaignRange: 10,
  casualtyRate: 0.12,
  raidLoot: 0.35,
  tributeRate: 0.1,
  conquestMassacre: 1,
  secession: 1,
  vassalThreshold: 0.2,
  vassalTribute: 0.15,
  campaignDays: 30,
  woundRate: 0.3,
  tradeRange: 8,
  tradeRate: 0.5,
  marriageRange: 5,
  intermarriage: 0.05,
  kinPeace: 1,
  emigration: 0.1,
};

export interface ParamDef {
  key: keyof Params;
  name: string;
  desc: string;
  min: number;
  max: number;
  step: number;
}

export const PARAM_DEFS: ParamDef[] = [
  { key: 'foodNeedAdult', name: '成人日需食物', desc: '成年人每天需要的食物单位', min: 0.5, max: 2, step: 0.1 },
  { key: 'gatherRate', name: '采集产出', desc: '普通人每小时采集的食物（资源充足、工具完好时）', min: 0.1, max: 2, step: 0.05 },
  { key: 'huntRate', name: '狩猎产出', desc: '普通猎人每小时的食物（猎物充足时）', min: 0.1, max: 2, step: 0.05 },
  { key: 'fishRate', name: '捕鱼产出', desc: '普通渔民每小时的食物（鱼群充足时）', min: 0.1, max: 2, step: 0.05 },
  { key: 'farmRate', name: '耕作产出', desc: '一个农民在一块耕地上每小时的平均食物（生长季更高，冬季为零）', min: 0.1, max: 3, step: 0.05 },
  { key: 'farmLabor', name: '精耕饱和', desc: '每块耕地每天投入多少工时（乘以能力）时，每小时的收成降到一半；越小，人多地少时越要起早贪黑', min: 2, max: 40, step: 1 },
  { key: 'herdRate', name: '放牧产出', desc: '普通牧民每小时的食物', min: 0.1, max: 2, step: 0.05 },
  { key: 'toolRate', name: '工具产出', desc: '工匠每小时制作的工具件数', min: 0.005, max: 0.1, step: 0.001 },
  { key: 'clothesRate', name: '衣物产出', desc: '缝制者每小时制作的衣物件数', min: 0.005, max: 0.1, step: 0.001 },
  { key: 'foodDecay', name: '食物腐坏率', desc: '储存食物每天损失的比例', min: 0, max: 0.02, step: 0.001 },
  { key: 'abilityWeight', name: '能力影响', desc: '能力偏离均值对产出的影响强度', min: 0, max: 1.5, step: 0.05 },
  { key: 'skillGain', name: '熟练积累', desc: '每天干满 8 小时积累的熟练度', min: 0, max: 0.01, step: 0.0005 },
  { key: 'toolBonus', name: '工具加成', desc: '完好工具带来的产出加成', min: 0, max: 1.5, step: 0.05 },
  { key: 'plantRegen', name: '植物再生', desc: '野生植物的日再生率', min: 0.001, max: 0.05, step: 0.001 },
  { key: 'gameRegen', name: '猎物再生', desc: '猎物的日再生率', min: 0.001, max: 0.05, step: 0.001 },
  { key: 'maxHours', name: '每日最多工时', desc: '一天里可用于劳动的小时数，其余是闲暇', min: 6, max: 16, step: 1 },
  { key: 'fatigue', name: '劳累成本', desc: '第 h 小时劳动的边际代价约为 系数×h（以食物计）；越高人们越早收工。勤劳的人代价低', min: 0.01, max: 0.5, step: 0.01 },
  { key: 'bufferDays', name: '安全存粮天数', desc: '存粮低于这么多天（加上农闲季节天数，但不超过食物保存期限）时，多干活的价值明显上升', min: 0, max: 200, step: 5 },
  { key: 'wealthStatus', name: '财富地位', desc: '交换社会中多积累财富本身带来的地位价值（乘以野心），让人吃饱后仍继续干活', min: 0, max: 2, step: 0.05 },
  { key: 'generosity', name: '慷慨声望', desc: '共享群体中看得见的贡献带来的声望价值（乘以文化对共享的重视和观察准确度）', min: 0, max: 2, step: 0.05 },
  { key: 'leisureJoy', name: '闲暇幸福', desc: '闲暇占可用时间的比例对幸福感的影响', min: 0, max: 1, step: 0.05 },
  { key: 'leisureResearch', name: '闲暇研究', desc: '闲暇中捣鼓的一小时相当于专职研究一小时的比例（再乘以数学能力）', min: 0, max: 0.2, step: 0.005 },
  { key: 'dunbar', name: '邓巴数', desc: '观察贡献的准确度在群体达到这个规模时降到一半（准确度 = 1/(1+(人数/邓巴数)²)）', min: 50, max: 400, step: 10 },
  { key: 'forageRange', name: '采猎活动范围', desc: '采集狩猎者每天离营地能走多远（通行成本，平原一格 = 1）；领地是这个范围内的地块', min: 1, max: 5, step: 0.1 },
  { key: 'farmRange', name: '农耕活动范围', desc: '农民每天往返田地的范围（通行成本）；农业村落的领地比采猎营地小', min: 0.5, max: 3, step: 0.1 },
  { key: 'herdRange', name: '放牧活动范围', desc: '牧民追逐草场的范围（通行成本）', min: 1, max: 6, step: 0.1 },
  { key: 'reciprocity', name: '条件互惠', desc: '公有聚落按声誉分配的强度：声誉低的人从公共储备分到的更少，也因此更愿意干活', min: 0, max: 1, step: 0.05 },
  { key: 'punishment', name: '官吏惩罚', desc: '统筹体制下官吏监督到的偷懒会受罚的强度（乘以官吏覆盖率）', min: 0, max: 1.5, step: 0.05 },
  { key: 'exileRep', name: '排挤门槛', desc: '声誉长期低于此值的人会被排挤出公有聚落', min: 0, max: 1, step: 0.05 },
  { key: 'exileMonths', name: '排挤忍耐', desc: '声誉连续低于门槛多少个月才会被排挤', min: 1, max: 60, step: 1 },
  { key: 'outsiderRep', name: '外来者声誉', desc: '迁入或被排挤到别处的人初始的声誉，需要靠贡献重新挣得', min: 0.2, max: 1, step: 0.05 },
  { key: 'fertility', name: '生育率', desc: '已婚育龄妇女每年生育概率', min: 0.05, max: 0.6, step: 0.01 },
  { key: 'baseMortality', name: '基础死亡率倍数', desc: '年龄相关死亡率的整体倍数', min: 0.2, max: 3, step: 0.05 },
  { key: 'huntDanger', name: '狩猎死亡风险', desc: '全职猎人（每天 8 小时）每年因狩猎意外死亡的概率；体能差的人更高，有弓箭后降低', min: 0, max: 0.1, step: 0.002 },
  { key: 'epidemicRate', name: '疫病爆发率', desc: '500 人、无免疫的聚落每月爆发疫病的概率；人越多越容易爆发，100 人以下几乎不会', min: 0, max: 0.1, step: 0.002 },
  { key: 'epidemicLethality', name: '疫病致死率', desc: '一场最严重的疫病（持续两个月）中健康成年人的死亡比例；幼儿、老人和体弱者加倍', min: 0, max: 0.6, step: 0.01 },
  { key: 'starvationDamage', name: '饥饿伤害', desc: '每天缺粮对健康的损伤', min: 0, max: 0.2, step: 0.005 },
  { key: 'coldDamage', name: '寒冷伤害', desc: '每天受冻对健康的损伤', min: 0, max: 0.2, step: 0.005 },
  { key: 'heritability', name: '遗传度', desc: '子女能力与父母的相关程度', min: 0, max: 1, step: 0.05 },
  { key: 'planNoise', name: '统筹误差', desc: '统筹者对需求判断的基础误差', min: 0, max: 2, step: 0.05 },
  { key: 'corruption', name: '腐败上限', desc: '诚信最低的掌权者每月从公库侵吞的比例', min: 0, max: 0.5, step: 0.01 },
  { key: 'reformMargin', name: '改革门槛', desc: '新选项的加权支持度需领先现行制度多少才会改革', min: 0, max: 0.5, step: 0.01 },
  { key: 'revoltThreshold', name: '起义门槛', desc: '平均不满超过多少才可能起义', min: 0.2, max: 0.9, step: 0.05 },
  { key: 'baseReach', name: '管理半径', desc: '首领在无官吏、无科技时能有效管理的通行距离', min: 2, max: 30, step: 1 },
  { key: 'enforceThreshold', name: '执行门槛', desc: '执行力低于此值时，聚落按本地习惯行事', min: 0, max: 1, step: 0.05 },
  { key: 'termYears', name: '选举任期', desc: '选举制下领袖任期（年）', min: 2, max: 30, step: 1 },
  { key: 'factionEngagement', name: '政治参与门槛', desc: '参与度（野心、不从众、不满、职位）达到此值的成年人才会加入派系；派系领袖的近亲总会跟随', min: 0, max: 1, step: 0.05 },
  { key: 'maxFactions', name: '派系上限', desc: '一个政体最多同时存在的派系（政党）数', min: 1, max: 12, step: 1 },
  { key: 'factionKin', name: '亲族纽带', desc: '同姓（同一父系）在选择派系时相当于多大的主张接近度；越大越容易形成家族派系', min: 0, max: 1, step: 0.05 },
  { key: 'factionIdentity', name: '身份纽带', desc: '同民族、同一职业阶层、同一聚落各自相当于多大的主张接近度', min: 0, max: 0.6, step: 0.05 },
  { key: 'factionDiscipline', name: '派系纪律', desc: '表决时成员跟随派系整体主张而不是自己意见的程度：0 = 各投各的，1 = 完全按派系投票', min: 0, max: 1, step: 0.05 },
  { key: 'partyLoyalty', name: '党派忠诚', desc: '选举中选民投给本派候选人的额外倾向（与"主张接近"在同一尺度上，约 0～6）', min: 0, max: 5, step: 0.1 },
  { key: 'uncheckedCoup', name: '无制衡政变风险', desc: '没有制衡时，合法性低于"40% + 此值"就可能有人发动政变（有制衡时为 40%，且政变概率减半）', min: 0, max: 0.4, step: 0.02 },
  { key: 'impeachRate', name: '罢免概率', desc: '有制衡、首领合法性低于 40% 且其派系在议事会/大会中不占多数时，每年被和平罢免的概率', min: 0, max: 1, step: 0.05 },
  { key: 'checkedGraft', name: '制衡抑制腐败', desc: '议事会否决下掌权者侵吞公库的比例乘以 (1−此值×0.6)，大会复决下乘以 (1−此值)', min: 0, max: 1, step: 0.05 },
  { key: 'interestRate', name: '利益驱动', desc: '个人利益改变倾向的速度（每月）', min: 0, max: 0.2, step: 0.005 },
  { key: 'conformRate', name: '从众', desc: '向周围人看齐的速度（每月）', min: 0, max: 0.2, step: 0.005 },
  { key: 'experienceRate', name: '经历', desc: '受苦经历让人否定现行制度的速度（每月）', min: 0, max: 0.2, step: 0.005 },
  { key: 'lbdRate', name: '干中学', desc: '从业者每干满 8 小时为相关科技积累的研究量', min: 0, max: 0.002, step: 0.00001 },
  { key: 'researchRate', name: '研究产出', desc: '专职研究者每干满 8 小时的研究量', min: 0, max: 0.2, step: 0.005 },
  { key: 'patronShare', name: '资助意愿', desc: '富人每月拿出多余财富资助研究的比例', min: 0, max: 0.3, step: 0.01 },
  { key: 'contactRange', name: '接触距离', desc: '两国聚落相距多少格以内即算接触', min: 2, max: 30, step: 1 },
  { key: 'warPropensity', name: '战争倾向', desc: '每个人主战意愿（几率比）的倍数；0 表示永不开战', min: 0, max: 3, step: 0.1 },
  { key: 'campaignRange', name: '出征半径', desc: '离目标多少格以内的聚落能出兵', min: 3, max: 30, step: 1 },
  { key: 'casualtyRate', name: '伤亡率', desc: '一次势均力敌的战役中参战者的阵亡比例', min: 0, max: 0.5, step: 0.01 },
  { key: 'raidLoot', name: '劫掠比例', desc: '劫掠完全得手时抢走目标聚落存粮的比例', min: 0, max: 1, step: 0.05 },
  { key: 'conquestMassacre', name: '征服屠杀', desc: '聚落被攻陷时，被征服民族的男性被杀的比例（含男童）', min: 0, max: 1, step: 0.05 },
  { key: 'vassalThreshold', name: '附庸门槛', desc: '执行力低于「执行门槛」但不低于此值的聚落是附庸：自行其是，只交名义贡赋；再低就是化外之地', min: 0, max: 0.6, step: 0.05 },
  { key: 'vassalTribute', name: '附庸贡赋', desc: '附庸收上来的税中交给中央的比例', min: 0, max: 0.6, step: 0.05 },
  { key: 'secession', name: '分离倾向', desc: '管不到的聚落每年独立或投靠邻国的倾向倍数；0 表示从不分离', min: 0, max: 3, step: 0.1 },
  { key: 'campaignDays', name: '出征天数', desc: '一次战役中参战者离家不劳动的天数（劫掠为三分之一，守方迎战约一半）', min: 0, max: 90, step: 5 },
  { key: 'woundRate', name: '负伤率', desc: '战斗中幸存的参战者负伤的比例；伤员健康下降 0.15～0.4，生产减少，健康过低不能再上阵', min: 0, max: 1, step: 0.05 },
  { key: 'tradeRange', name: '贸易距离', desc: '两国聚落相距多少格以内可以在边境集市交易（实际贸易量还随交通科技折算后的距离衰减）', min: 0, max: 20, step: 1 },
  { key: 'tradeRate', name: '贸易能力', desc: '相邻的两个聚落每月最多能交换的货值（食物当量）占较小一方人口的倍数；实际成交取决于双方的相对稀缺', min: 0, max: 3, step: 0.05 },
  { key: 'marriageRange', name: '通婚距离', desc: '两国聚落相距多少格以内，单身男女可以跨国结婚', min: 0, max: 12, step: 1 },
  { key: 'intermarriage', name: '通婚倾向', desc: '一位单身女子每月与邻国一位单身男子成婚的基础概率（和平关系、近距离、习俗相近时；接触 ×0.4，同盟 ×1.5）', min: 0, max: 0.2, step: 0.005 },
  { key: 'kinPeace', name: '亲缘厌战', desc: '配偶、母亲或子女属于对方民族或住在对方国内的人，主战意愿（几率比的对数）降低多少', min: 0, max: 3, step: 0.1 },
  { key: 'emigration', name: '跨国逃荒', desc: '连续缺粮两个月以上的聚落里，每户每月投奔邻国不缺粮聚落的概率', min: 0, max: 0.5, step: 0.01 },
  { key: 'tributeRate', name: '贡赋比例', desc: '朝贡国每年缴纳的公库与公共储备（食物、工具、衣物）比例', min: 0, max: 0.5, step: 0.01 },
];
