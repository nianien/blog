export default function AboutPage() {
  return (
    <div className="bg-[var(--background)] py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">

        {/* Professional Summary */}
        <div className="mx-auto mt-8 max-w-4xl lg:mx-0">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            技术架构师｜平台工程｜智能风控
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            专注分布式系统、平台化与 AI 工程化落地。以 <strong>标准化 / 平台化 / 自动化</strong> 为方法论，解决大规模、高复杂度系统的可扩展与可治理问题。
          </p>
          <p className="mt-4 text-lg font-medium text-gray-800 italic">
            Think ahead, see beyond.
          </p>
        </div>

        {/* Education (moved before Work Experience) */}
        <div className="mx-auto mt-12 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">教育背景</h2>
          <div className="mt-6">
            <div className="border-l-4 border-blue-500 pl-4">
              <h3 className="text-lg font-semibold text-gray-900">中国人民大学</h3>
              <p className="text-gray-600">计算机软件与理论 硕士</p>
            </div>
          </div>
        </div>


        {/* Work Experience */}
        <div className="mx-auto mt-16 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">工作经历</h2>
          <div className="mt-8 space-y-12">
            {/* TikTok */}
            <div className="border-l-4 border-blue-500 pl-6">
              <h3 className="text-xl font-semibold text-gray-900">
                TikTok Australia ｜ 技术架构师，Data Trust & Safety
              </h3>
              <ul className="mt-4 space-y-2 text-gray-600">
                <li className="flex items-start space-x-2">
                  <span className="text-gray-400">·</span>
                  <span>构建内容安全推理与治理平台，实现多模型编排与自动化迭代，<strong>推理性能提升200%</strong>。</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-gray-400">·</span>
                  <span>设计实时回扫与知识库审核体系，支撑日均<strong>260亿次</strong>内容识别与治理。</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-gray-400">·</span>
                  <span>自研 Golang 热更新机制与跨区域容灾方案，实现在线无损发布与分钟级切换。</span>
                </li>
              </ul>
            </div>

            {/* Kuaishou */}
            <div className="border-l-4 border-green-500 pl-6">
              <h3 className="text-xl font-semibold text-gray-900">
                快手 ｜ 高级技术经理，商业化技术部／业务中台
              </h3>
              <ul className="mt-4 space-y-2 text-gray-600">
                <li className="flex items-start space-x-2">
                  <span className="text-gray-400">·</span>
                  <span>主导商业化 CRM 与政策中台建设，形成统一可复用的中台架构。</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-gray-400">·</span>
                  <span>重构账户体系与业务入驻流程，实现多层租户与标准化治理。</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-gray-400">·</span>
                  <span>推动规则引擎与元数据引擎低代码化落地，加速业务策略迭代。</span>
                </li>
              </ul>
            </div>

            {/* Alibaba */}
            <div className="border-l-4 border-orange-500 pl-6">
              <h3 className="text-xl font-semibold text-gray-900">
                阿里巴巴 ｜ 高级技术专家（智能营销 / 数字供应链）
              </h3>
              <ul className="mt-4 space-y-2 text-gray-600">
                <li className="flex items-start space-x-2">
                  <span className="text-gray-400">·</span>
                  <span>构建智能风控与数据中台，统一支撑<strong>40+场景</strong>，系统吞吐性能提升<strong>3倍</strong>。</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-gray-400">·</span>
                  <span>设计百亿级 Spark 实时处理与专家系统，形成智能风控一体化平台。</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-gray-400">·</span>
                  <span>主导私有云安全改造与多租户供应链平台建设，满足最高等保与多业务并行需求。</span>
                </li>
              </ul>
            </div>

            {/* Other Companies */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border-l-4 border-purple-500 pl-4">
                <h4 className="text-lg font-medium text-gray-800">百度</h4>
                <p className="text-sm text-gray-600 mt-2">高级开发工程师，程序化广告交易工程平台技术部</p>
                <p className="text-sm text-gray-600 mt-1">主导系统微服务化与日志追踪体系建设，提升分布式可观测性与稳定性。</p>
              </div>
              
              <div className="border-l-4 border-indigo-500 pl-4">
                <h4 className="text-lg font-medium text-gray-800">网易</h4>
                <p className="text-sm text-gray-600 mt-2">开发工程师，网站部／产品技术中心</p>
                <p className="text-sm text-gray-600 mt-1">基于 Lucene 重构微博搜索系统，<strong>查询性能提升90%</strong>。</p>
              </div>
            </div>
          </div>
        </div>

        {/* Skills */}
        <div className="mx-auto mt-16 max-w-4xl lg:mx-0">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">专业技能</h2>
            <div className="mt-6 space-y-4">
              <div className="flex items-start space-x-3">
                <span className="text-blue-600 font-bold">•</span>
                <div>
                  <p className="font-medium text-gray-900">系统架构设计与治理</p>
                  <p className="text-sm text-gray-600">分布式系统、微服务架构、高可用与容灾体系设计</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <span className="text-blue-600 font-bold">•</span>
                <div>
                  <p className="font-medium text-gray-900">业务中台与领域建模</p>
                  <p className="text-sm text-gray-600">DDD、领域服务治理、SaaS化与低代码平台建设</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <span className="text-blue-600 font-bold">•</span>
                <div>
                  <p className="font-medium text-gray-900">AI与数据智能平台</p>
                  <p className="text-sm text-gray-600">模型推理框架、智能风控体系、分布式数据处理</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <span className="text-blue-600 font-bold">•</span>
                <div>
                  <p className="font-medium text-gray-900">云原生与基础设施工程</p>
                  <p className="text-sm text-gray-600">AWS / GCP / 阿里云 / 自动化运维与持续交付</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="mx-auto mt-16 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">联系方式</h2>
          <p className="mt-6 text-base leading-7 text-gray-600">
            如果你对我的文章有任何想法或建议，欢迎通过以下方式联系我：
          </p>
          <div className="mt-6 space-y-4">
            <div className="flex items-center space-x-3">
              <span className="text-gray-500">邮箱：</span>
              <a href="mailto:nianien@gmail.com" className="text-blue-600 hover:text-blue-500">
                nianien@gmail.com
              </a>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-gray-500">GitHub：</span>
              <a href="https://github.com/nianien" className="text-blue-600 hover:text-blue-500">
                github.com/nianien
              </a>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-gray-500">公众号：</span>
              <span className="text-gray-700 font-medium">xijianghuanyue</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 