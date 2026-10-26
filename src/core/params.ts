// Every tunable mechanism coefficient lives here, with a description, so experiments can vary them.

export interface Params {
  // Food and production
  foodNeedAdult: number;
  gatherRate: number;
  huntRate: number;
  fishRate: number;
  farmRate: number;
  herdRate: number;
  toolRate: number;
  clothesRate: number;
  foodDecay: number;
  abilityWeight: number;
  skillGain: number;
  toolBonus: number;
  plantRegen: number;
  gameRegen: number;
  // Incentives
  freeRide: number;
  dunbar: number;
  // Demography
  fertility: number;
  baseMortality: number;
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
}

export const DEFAULT_PARAMS: Params = {
  foodNeedAdult: 1,
  gatherRate: 2.5,
  huntRate: 3.0,
  fishRate: 2.8,
  farmRate: 4.0,
  herdRate: 3.2,
  toolRate: 0.12,
  clothesRate: 0.08,
  foodDecay: 0.004,
  abilityWeight: 0.5,
  skillGain: 0.0015,
  toolBonus: 0.4,
  plantRegen: 0.02,
  gameRegen: 0.012,
  freeRide: 0.6,
  dunbar: 150,
  fertility: 0.3,
  baseMortality: 1,
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
  interestRate: 0.012,
  conformRate: 0.02,
  experienceRate: 0.012,
  lbdRate: 0.0002,
  researchRate: 0.004,
  patronShare: 0.01,
  contactRange: 8,
  warPropensity: 1,
  campaignRange: 10,
  casualtyRate: 0.12,
  raidLoot: 0.35,
  tributeRate: 0.1,
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
  { key: 'gatherRate', name: '采集产出', desc: '普通人每天采集的食物（资源充足、工具完好时）', min: 0.5, max: 4, step: 0.1 },
  { key: 'huntRate', name: '狩猎产出', desc: '普通猎人每天的食物', min: 0.5, max: 4, step: 0.1 },
  { key: 'fishRate', name: '捕鱼产出', desc: '普通渔民每天的食物', min: 0.5, max: 4, step: 0.1 },
  { key: 'farmRate', name: '耕作产出', desc: '一块耕地一个农民每天的平均食物', min: 0.5, max: 6, step: 0.1 },
  { key: 'herdRate', name: '放牧产出', desc: '普通牧民每天的食物', min: 0.5, max: 5, step: 0.1 },
  { key: 'toolRate', name: '工具产出', desc: '工匠每天制作的工具件数', min: 0.02, max: 0.5, step: 0.01 },
  { key: 'clothesRate', name: '衣物产出', desc: '缝制者每天制作的衣物件数', min: 0.02, max: 0.5, step: 0.01 },
  { key: 'foodDecay', name: '食物腐坏率', desc: '储存食物每天损失的比例', min: 0, max: 0.02, step: 0.001 },
  { key: 'abilityWeight', name: '能力影响', desc: '能力偏离均值对产出的影响强度', min: 0, max: 1.5, step: 0.05 },
  { key: 'skillGain', name: '熟练积累', desc: '每天工作积累的熟练度', min: 0, max: 0.01, step: 0.0005 },
  { key: 'toolBonus', name: '工具加成', desc: '完好工具带来的产出加成', min: 0, max: 1.5, step: 0.05 },
  { key: 'plantRegen', name: '植物再生', desc: '野生植物的日再生率', min: 0.001, max: 0.05, step: 0.001 },
  { key: 'gameRegen', name: '猎物再生', desc: '猎物的日再生率', min: 0.001, max: 0.05, step: 0.001 },
  { key: 'freeRide', name: '搭便车强度', desc: '产出不归自己且缺乏监督时，努力程度下降的上限', min: 0, max: 1, step: 0.05 },
  { key: 'dunbar', name: '邓巴数', desc: '共享群体中可以相互监督的规模', min: 50, max: 400, step: 10 },
  { key: 'fertility', name: '生育率', desc: '已婚育龄妇女每年生育概率', min: 0.05, max: 0.6, step: 0.01 },
  { key: 'baseMortality', name: '基础死亡率倍数', desc: '年龄相关死亡率的整体倍数', min: 0.2, max: 3, step: 0.05 },
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
  { key: 'interestRate', name: '利益驱动', desc: '个人利益改变倾向的速度（每月）', min: 0, max: 0.2, step: 0.005 },
  { key: 'conformRate', name: '从众', desc: '向周围人看齐的速度（每月）', min: 0, max: 0.2, step: 0.005 },
  { key: 'experienceRate', name: '经历', desc: '受苦经历让人否定现行制度的速度（每月）', min: 0, max: 0.2, step: 0.005 },
  { key: 'lbdRate', name: '干中学', desc: '从业者每天为相关科技积累的研究量', min: 0, max: 0.002, step: 0.00001 },
  { key: 'researchRate', name: '研究产出', desc: '专职研究者每天的研究量', min: 0, max: 0.2, step: 0.005 },
  { key: 'patronShare', name: '资助意愿', desc: '富人每月拿出多余财富资助研究的比例', min: 0, max: 0.3, step: 0.01 },
  { key: 'contactRange', name: '接触距离', desc: '两国聚落相距多少格以内即算接触', min: 2, max: 30, step: 1 },
  { key: 'warPropensity', name: '战争倾向', desc: '每个人主战意愿（几率比）的倍数；0 表示永不开战', min: 0, max: 3, step: 0.1 },
  { key: 'campaignRange', name: '出征半径', desc: '离目标多少格以内的聚落能出兵', min: 3, max: 30, step: 1 },
  { key: 'casualtyRate', name: '伤亡率', desc: '一次势均力敌的战役中参战者的阵亡比例', min: 0, max: 0.5, step: 0.01 },
  { key: 'raidLoot', name: '劫掠比例', desc: '劫掠完全得手时抢走目标聚落存粮的比例', min: 0, max: 1, step: 0.05 },
  { key: 'tributeRate', name: '贡赋比例', desc: '朝贡国每年缴纳的公库与存粮比例', min: 0, max: 0.5, step: 0.01 },
];
