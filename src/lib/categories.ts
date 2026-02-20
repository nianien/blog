// 物理目录 → 虚拟分类路径的映射
// 文件不动，URL 不变，只在导航层做虚拟分组
export const DIR_TO_VIRTUAL: Record<string, string> = {
  'engineering/agentic':      'engineering/agentic',
  'engineering/architecture': 'engineering/architecture',
  'engineering/domain':       'engineering/domain',
  'engineering/middleware':    'engineering/middleware',
  'engineering/practice':     'engineering/practice',
  'engineering/tooling':      'engineering/tooling',
  'engineering/data':         'engineering/data',
  'insights/technology':      'industry/technology',
  'insights/business':        'industry/business',
  'insights/finance':         'industry/finance',
  'insights/science':         'science/science',
  'life/digital':             'life/digital',
};

// 所有分类的元数据（使用虚拟路径作为 key）
export const CATEGORY_META: Record<string, { name: string; description: string }> = {
  // 一级
  'engineering': { name: 'Engineering', description: '系统构建与工程实践' },
  'industry':    { name: 'Industry',    description: '产业洞察与商业博弈' },
  'science':     { name: 'Science',     description: '科学原理与第一性思考' },
  'life':        { name: 'Life',        description: '个体成长与生活实践' },
  // 二级 — Engineering
  'engineering/agentic':      { name: 'Agentic 系统', description: 'AI Agent 系统设计与实现' },
  'engineering/architecture': { name: '架构设计',     description: '系统架构与微服务' },
  'engineering/domain':       { name: '领域建模',     description: '业务架构与领域驱动设计' },
  'engineering/middleware':   { name: '中间件',       description: '消息队列、分布式事务等' },
  'engineering/practice':     { name: '工程实践',     description: 'DevOps、CI/CD 与工程化' },
  'engineering/tooling':      { name: '开发工具',     description: 'Git、Maven 等开发工具' },
  'engineering/data':         { name: '数据工程',     description: '大数据与数据分析' },
  // 二级 — Industry
  'industry/technology': { name: '技术洞察', description: 'AI、区块链等技术趋势' },
  'industry/business':   { name: '商业思考', description: '创业、品牌与商业模式' },
  'industry/finance':    { name: '金融分析', description: '投资、数字货币与产业分析' },
  // 二级 — Science
  'science/science': { name: '科学探索', description: '语言学、认知科学等' },
  // 二级 — Life
  'life/digital': { name: '数字生活', description: '数字游民、AI 生活与赛博现实' },
};

export const MAIN_CATEGORIES = ['engineering', 'industry', 'science', 'life'] as const;
