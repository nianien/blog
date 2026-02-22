export default function AboutPage() {
  return (
    <div className="bg-[var(--background)] py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">

        {/* Introduction */}
        <div className="mx-auto mt-8 max-w-4xl lg:mx-0">
          <p className="text-lg leading-8 text-gray-600">
            15 年互联网系统架构与平台建设经验，专注分布式系统、平台工程与智能风控。擅长在日均百亿级请求规模下完成复杂业务抽象、体系化架构设计与工程方法论沉淀。近期关注 AI 工程化落地与 AIGC 商业化探索。
          </p>
          <p className="mt-3 text-base leading-7 text-gray-400">
            15 years in internet-scale system architecture and platform engineering, specializing in distributed systems, platform infra, and intelligent risk control. Currently exploring AI engineering and AIGC commercialization.
          </p>
          <p className="mt-4 text-sm text-gray-500">
            中国人民大学 · 计算机软件与理论硕士
            <span className="mx-2 text-gray-300">|</span>
            M.S. Computer Science, Renmin University of China
          </p>
        </div>

        {/* Blog Positioning */}
        <div className="mx-auto mt-14 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">关于这个博客</h2>
          <p className="mt-4 text-base leading-7 text-gray-600">
            围绕「复杂系统如何被设计、演化和博弈」，从四个维度记录思考：
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
                <p className="font-medium text-gray-900">Industry</p>
                <p className="text-sm text-gray-500">产业洞察与商业博弈</p>
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

        {/* Work Experience */}
        <div className="mx-auto mt-14 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">工作经历</h2>
          <div className="mt-8 space-y-6">
            <div className="border-l-4 border-rose-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                AIGC 短剧出海 · 技术负责人
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">创业项目 · Tech Lead &amp; Co-founder</p>
              <p className="mt-2 text-sm text-gray-600">
                面向东南亚市场，探索 AIGC 在短剧本地化场景的工业化流程与商业化落地
              </p>
            </div>
            <div className="border-l-4 border-blue-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                TikTok Australia · 技术架构师
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">Data Trust &amp; Safety · Tech Architect · Sydney</p>
              <p className="mt-2 text-sm text-gray-600">
                负责内容安全核心链路的推理平台架构，以及多区域容灾与在线热更新方案
              </p>
            </div>
            <div className="border-l-4 border-green-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                快手 Kuaishou · 技术负责人
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">商业化技术部 · Tech Director · Beijing</p>
              <p className="mt-2 text-sm text-gray-600">
                主导商业化中台的领域建模与架构重构，建设面向业务的规则平台与服务治理体系
              </p>
            </div>
            <div className="border-l-4 border-orange-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                阿里巴巴 Alibaba · 高级技术专家
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">智能营销 / 新零售事业群 · Sr. Tech Lead · Beijing</p>
              <p className="mt-2 text-sm text-gray-600">
                建设智能风控体系与分布式计算框架，推动新零售供应链平台的 SaaS 化演进
              </p>
            </div>
            <div className="border-l-4 border-purple-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                百度 Baidu · 高级开发工程师
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">百度联盟 · Sr. Engineer · Beijing</p>
              <p className="mt-2 text-sm text-gray-600">
                负责程序化广告交易平台的架构设计与微服务化改造，建设分布式任务调度平台
              </p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                网易 NetEase · 高级开发工程师
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">网站部 · Sr. Engineer · Beijing</p>
              <p className="mt-2 text-sm text-gray-600">
                负责网易微博搜索，基于 Lucene 构建通用分布式搜索架构
              </p>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="mx-auto mt-14 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">联系</h2>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <span className="text-gray-600">
              Email: <a href="mailto:neil.ln@outlook.com" className="text-blue-600 hover:text-blue-500">neil.ln@outlook.com</a>
            </span>
            <span className="text-gray-600">
              GitHub: <a href="https://github.com/nianien" className="text-blue-600 hover:text-blue-500">nianien</a>
            </span>
            <span className="text-gray-600">
              公众号: xijianghuanyue
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
