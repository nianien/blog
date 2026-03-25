export default function AboutPage() {
  return (
    <div className="bg-[var(--background)] py-12 sm:py-16">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">

        {/* Introduction - Personal Narrative */}
        <div className="mx-auto mt-8 max-w-4xl lg:mx-0">
          <div className="space-y-4 text-base leading-7 text-gray-600">
            <p>
              人大计算机硕士毕业后，在互联网行业做了十五年技术。
            </p>
            <p>
              早期在网易做搜索，用 Lucene 搭分布式检索架构，是最原始的{"\u201C"}让信息被找到{"\u201D"}。后来到百度做广告系统，开始接触大规模分布式计算和程序化交易——系统的复杂度一下从{"\u201C"}能跑{"\u201D"}跳到了{"\u201C"}不能挂{"\u201D"}。
            </p>
            <p>
              在阿里的几年做了两件事：智能风控和新零售供应链平台。前者让我理解了对抗性系统的设计思路，后者让我第一次完整经历了从 0 到 1 的平台 SaaS 化。之后去快手带商业化技术团队，核心工作是把一个野蛮生长的业务系统做领域建模和架构重构——大概是职业生涯里最考验{"\u201C"}架构审美{"\u201D"}的阶段。
            </p>
            <p>
              再后来去了 TikTok 悉尼，做内容安全方向的推理平台架构。第一次在海外团队工作，技术之外多了很多跨文化协作的体感。
            </p>
            <p>
              现在在做 AIGC 短剧出海的创业项目。从系统架构转向内容工程，关注的问题从{"\u201C"}系统怎么不挂{"\u201D"}变成了{"\u201C"}内容怎么生成{"\u201D"}。用扩散模型、视频生成、语音合成这些技术搭建 AI 短剧的工业化生产流程，面向东南亚市场做本地化落地。
            </p>
          </div>
          <p className="mt-6 text-sm text-gray-400">
            Renmin University of China · M.S. Computer Science
          </p>
        </div>

        {/* Blog Positioning */}
        <div className="mx-auto mt-14 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">关于这个博客</h2>
          <p className="mt-4 text-base leading-7 text-gray-600">
            做了这些年技术，越来越觉得值得写下来的不是某个框架怎么用，而是复杂系统背后的设计选择和演化逻辑。这个博客围绕「复杂系统如何被设计、演化和博弈」，从四个维度记录思考：
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

        {/* Career Timeline */}
        <div className="mx-auto mt-14 max-w-4xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">经历</h2>
          <div className="mt-8 space-y-6">
            <div className="border-l-4 border-rose-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                AIGC 短剧出海
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">Co-founder · 创业中</p>
            </div>
            <div className="border-l-4 border-blue-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                TikTok
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">Tech Architect · Sydney</p>
            </div>
            <div className="border-l-4 border-green-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                快手
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">Tech Director · Beijing</p>
            </div>
            <div className="border-l-4 border-orange-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                阿里巴巴
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">Sr. Tech Lead · Beijing</p>
            </div>
            <div className="border-l-4 border-purple-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                百度
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">Sr. Engineer · Beijing</p>
            </div>
            <div className="border-l-4 border-indigo-500 pl-6">
              <h3 className="text-base font-semibold text-gray-900">
                网易
              </h3>
              <p className="text-sm text-gray-400 mt-0.5">Sr. Engineer · Beijing</p>
            </div>
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
