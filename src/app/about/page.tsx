export default function AboutPage() {
  return (
    <div className="bg-[var(--background)] py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">

        {/* Introduction */}
        <div className="mx-auto mt-8 max-w-4xl lg:mx-0">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Skyfalling
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            技术架构师，先后在网易、百度、阿里巴巴、快手、TikTok 从事平台工程与系统架构工作。关注分布式系统、AI 工程化、智能风控，以及技术背后的产业逻辑和第一性原理。
          </p>
          <p className="mt-3 text-base leading-7 text-gray-500">
            中国人民大学 · 计算机软件与理论硕士
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
          <div className="mt-8 space-y-10">
            {/* TikTok */}
            <div className="border-l-4 border-blue-500 pl-6">
              <h3 className="text-lg font-semibold text-gray-900">
                TikTok Australia · 技术架构师
              </h3>
              <p className="text-sm text-gray-500 mt-1">Data Trust & Safety</p>
              <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
                <li>构建内容安全推理与治理平台，多模型编排，<strong>推理性能提升 200%</strong></li>
                <li>实时回扫与知识库审核体系，日均 <strong>260 亿次</strong>内容识别</li>
                <li>自研 Golang 热更新与跨区域容灾，在线无损发布</li>
              </ul>
            </div>

            {/* Kuaishou */}
            <div className="border-l-4 border-green-500 pl-6">
              <h3 className="text-lg font-semibold text-gray-900">
                快手 · 高级技术经理
              </h3>
              <p className="text-sm text-gray-500 mt-1">商业化技术部 / 业务中台</p>
              <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
                <li>主导商业化 CRM 与政策中台，统一可复用的中台架构</li>
                <li>重构账户体系与入驻流程，多层租户与标准化治理</li>
                <li>规则引擎与元数据引擎低代码化落地</li>
              </ul>
            </div>

            {/* Alibaba */}
            <div className="border-l-4 border-orange-500 pl-6">
              <h3 className="text-lg font-semibold text-gray-900">
                阿里巴巴 · 高级技术专家
              </h3>
              <p className="text-sm text-gray-500 mt-1">智能营销 / 数字供应链</p>
              <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
                <li>智能风控与数据中台，统一支撑 <strong>40+ 场景</strong>，吞吐性能提升 <strong>3 倍</strong></li>
                <li>百亿级 Spark 实时处理与专家系统，风控一体化平台</li>
                <li>私有云安全改造与多租户供应链平台</li>
              </ul>
            </div>

            {/* Earlier */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border-l-4 border-purple-500 pl-4">
                <h4 className="text-base font-medium text-gray-800">百度 · 高级开发工程师</h4>
                <p className="text-sm text-gray-500 mt-1">程序化广告交易平台</p>
                <p className="text-sm text-gray-600 mt-1">系统微服务化与分布式日志追踪体系</p>
              </div>
              <div className="border-l-4 border-indigo-500 pl-4">
                <h4 className="text-base font-medium text-gray-800">网易 · 开发工程师</h4>
                <p className="text-sm text-gray-500 mt-1">网站部 / 产品技术中心</p>
                <p className="text-sm text-gray-600 mt-1">基于 Lucene 重构搜索系统，查询性能提升 <strong>90%</strong></p>
              </div>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="mx-auto mt-14 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">联系</h2>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <a href="mailto:nianien@gmail.com" className="text-blue-600 hover:text-blue-500">
              nianien@gmail.com
            </a>
            <a href="https://github.com/nianien" className="text-blue-600 hover:text-blue-500">
              GitHub
            </a>
            <span className="text-gray-600">
              公众号: xijianghuanyue
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
