// 所有分类的元数据（路径即物理目录路径）
export const CATEGORY_META: Record<string, { name: string; description: string }> = {
  // 一级
  'engineering': { name: '技术', description: '系统构建与工程实践' },
  'insights':    { name: '思考', description: '技术趋势、商业分析与行业观察' },
  'science':     { name: '科学', description: '科学原理与第一性思考' },
  'life':        { name: '生活', description: '个体成长与生活实践' },
  // 二级 — Engineering
  'engineering/agentic':      { name: 'Agentic 系统', description: 'AI Agent 系统设计与实现' },
  'engineering/architecture': { name: '架构设计',     description: '系统架构与微服务' },
  'engineering/domain':       { name: '领域建模',     description: '业务架构与领域驱动设计' },
  'engineering/middleware':   { name: '中间件',       description: '消息队列、分布式事务等' },
  'engineering/practice':     { name: '工程实践',     description: 'DevOps、CI/CD 与工程化' },
  'engineering/algorithm':    { name: '算法',         description: '算法设计与问题求解' },
  'engineering/data':         { name: '数据工程',     description: '大数据与数据分析' },
  // 二级 — Industry
  'insights/technology': { name: '技术趋势', description: 'AI、区块链等技术趋势' },
  'insights/business':   { name: '商业',     description: '创业、品牌与商业模式' },
  'insights/finance':    { name: '金融',     description: '投资、数字货币与产业分析' },
  // 二级 — Science
  'science/science':    { name: '科学探索', description: '语言学、认知科学等' },
  'science/cognition':  { name: '认知科学', description: '思维模型与决策心理学' },
  'science/complexity': { name: '复杂系统', description: '涌现、混沌与网络科学' },
  // 二级 — Life
  'life/digital': { name: '数字生活', description: '数字游民、AI 生活与赛博现实' },
  'life/growth':  { name: '个体成长', description: '学习方法与职业思考' },
  'life/reading': { name: '阅读笔记', description: '书评与深度阅读' },
};

export const MAIN_CATEGORIES = ['engineering', 'insights', 'science', 'life'] as const;
