export default function AboutPage() {
  return (
    <div className="bg-[var(--background)] py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">

        {/* Introduction - Personal Narrative */}
        <div className="mx-auto mt-8 max-w-4xl lg:mx-0">
          <div className="space-y-4 text-base leading-7 text-gray-600">
            <p>
              人大计算机硕士毕业，在互联网行业做了十五年技术。
            </p>
            <p>
              早年在网易负责微博搜索，基于 Lucene 构建分布式检索架构。之后加入百度，参与程序化广告交易平台的架构设计与微服务化改造，开始深入高并发与大规模分布式系统领域。
            </p>
            <p>
              在阿里巴巴的五年，先后负责智能风控体系建设、基于 Spark 的百亿级实时计算架构，以及新零售供应链平台的 SaaS 化演进。期间主导了「学习强国」后端平台的整体架构设计与私有化部署。这段经历让我对对抗性系统设计和平台从 0 到 1 的构建有了比较完整的认知。
            </p>
            <p>
              之后在快手带商业化技术团队，管理三十人左右的研发团队。核心工作是为快速增长的业务系统做领域建模与架构重构，同期自研了一套规则引擎，覆盖九十多个业务场景。这个阶段对我而言最大的锻炼在于：如何在业务高速运转的同时完成底层架构的升级。
            </p>
            <p>
              后来加入 TikTok 悉尼，在 Data Trust & Safety 团队负责内容安全方向的推理平台架构，日均处理 260 亿次模型推理请求。这是我第一次在海外团队工作，也是在这个阶段开始接触 RAG 等 AI 工程化实践。
            </p>
            <p>
              目前正在创业，方向是 AIGC 短剧出海。从系统架构转向内容工程，关注的核心问题从「系统如何稳定运行」转变为「内容如何高效生成」。基于扩散模型、视频生成、语音合成等技术，搭建 AI 短剧的工业化生产流程，面向东南亚和印度市场做本地化落地。
            </p>
          </div>
          <p className="mt-6 text-sm text-gray-400">
            中国人民大学 · 计算机软件与理论硕士
          </p>
        </div>

        {/* Blog Positioning */}
        <div className="mx-auto mt-14 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">关于这个博客</h2>
          <p className="mt-4 text-base leading-7 text-gray-600">
            十几年下来，越来越觉得值得沉淀的不是某个框架怎么用，而是复杂系统背后的设计选择与演化逻辑。这个博客围绕「复杂系统如何被设计、演化和博弈」，从四个维度记录思考：
          </p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start space-x-3">
              <span className="text-blue-600 font-bold text-lg">E</span>
              <div>
                <p className="font-medium text-gray-900">Engineering</p>
                <p className="text-sm text-gray-500">系统构建与工程实践</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-blue-600 font-bold text-lg">I</span>
              <div>
                <p className="font-medium text-gray-900">Insights</p>
                <p className="text-sm text-gray-500">产业洞察与趋势判断</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-blue-600 font-bold text-lg">S</span>
              <div>
                <p className="font-medium text-gray-900">Science</p>
                <p className="text-sm text-gray-500">科学原理与第一性思考</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-blue-600 font-bold text-lg">L</span>
              <div>
                <p className="font-medium text-gray-900">Life</p>
                <p className="text-sm text-gray-500">个体成长与生活实践</p>
              </div>
            </div>
          </div>
        </div>

        {/* Career Path - Horizontal Flow */}
        <div className="mx-auto mt-14 max-w-4xl lg:mx-0">
          <div className="flex flex-wrap items-center gap-y-2 text-sm text-gray-500">
            <span className="font-medium text-gray-900">网易</span>
            <span className="mx-2 text-gray-300">→</span>
            <span className="font-medium text-gray-900">百度</span>
            <span className="mx-2 text-gray-300">→</span>
            <span className="font-medium text-gray-900">阿里巴巴</span>
            <span className="mx-2 text-gray-300">→</span>
            <span className="font-medium text-gray-900">快手</span>
            <span className="mx-2 text-gray-300">→</span>
            <span className="font-medium text-gray-900">TikTok</span>
            <span className="mx-1.5 text-gray-300">·</span>
            <span className="text-gray-400">Sydney</span>
            <span className="mx-2 text-gray-300">→</span>
            <span className="font-medium text-rose-600">AIGC 创业中</span>
          </div>
        </div>

        {/* Contact */}
        <div className="mx-auto mt-14 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">联系</h2>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <span className="text-gray-600">
              Email: <a href="mailto:skyfalling@live.com" className="text-blue-600 hover:text-blue-500">skyfalling@live.com</a>
            </span>
            <span className="text-gray-600">
              GitHub: <a href="https://github.com/nianien" className="text-blue-600 hover:text-blue-500">nianien</a>
            </span>
            <span className="text-gray-600">
              公众号: 滕源柘美
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
