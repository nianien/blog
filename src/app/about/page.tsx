import type { Metadata } from 'next';
import Link from 'next/link';
import ContactLinks from '@/components/ContactLinks';
import { CATEGORY_META, MAIN_CATEGORIES } from '@/lib/categories';
import { articlePathname } from '@/lib/content-paths';

export const metadata: Metadata = {
  title: '关于',
  description: 'Skyfalling 的技术经历、写作主题与联系方式',
  alternates: { canonical: '/about/' },
};

const mosikaArticle = articlePathname('engineering/domain/dual-language-rule-engine');

export default function AboutPage() {
  return (
    <div className="reading-shell page-space about-page">
      <h1 className="page-title">关于我</h1>
      <p className="about-intro">我是 Skyfalling，中国人民大学计算机硕士，一名拥有十五年互联网经验的架构师和技术管理者。</p>
      <p>从搜索、广告、风控到内容安全与 AIGC，我长期处理同一类问题：当业务快速变化、规模持续增长、系统边界不断扩张时，如何让技术架构保持稳定、可演进、可验证和可解释。</p>
      <section>
        <h2>关于这个博客</h2>
        <p>这个博客记录我在工程实践、业务系统、产业观察和个人成长中的长期思考。技术文章尽量从真实问题出发，讲清约束、选择、实现与验证；行业文章关注技术如何进入业务、组织和产业，并形成可以持续积累的能力。</p>
        <p>我更关心一项设计为什么成立、在什么条件下成立，以及系统继续演进时哪些部分需要保持稳定。内容主要分为四个方向：</p>
        <ul className="about-categories">
          {MAIN_CATEGORIES.map(key => <li key={key}><Link href={`/blog/category/${key}/page/1`}>{CATEGORY_META[key].name}</Link><span>{CATEGORY_META[key].description}</span></li>)}
        </ul>
      </section>
      <section>
        <h2>经历</h2>
        <p><strong>搜索与广告系统。</strong>职业早期在网易负责微博搜索，基于 Lucene 构建分布式检索架构；之后在百度参与程序化广告交易平台的架构设计与微服务化改造，开始系统处理高并发和大规模分布式系统问题。</p>
        <p><strong>平台与风控架构。</strong>在阿里巴巴的五年，先后负责智能风控体系、基于 Spark 的百亿级实时计算架构，以及新零售供应链平台的 SaaS 化演进。期间主导“学习强国”后端平台的整体架构设计与私有化部署，形成了对对抗性系统和平台从 0 到 1 建设的完整认识。</p>
        <p><strong>技术管理与规则引擎。</strong>在快手负责商业化技术团队，管理三十人左右的研发团队，围绕快速增长的业务进行领域建模和架构重构；同期自研 <Link href={mosikaArticle}>Mosika 规则引擎</Link>，将规则编排、脚本计算、运行归因和可视化操作贯通，覆盖九十多个业务场景。</p>
        <p><strong>全球化内容安全与 AI 工程。</strong>后来加入 TikTok 悉尼，在 Data Trust &amp; Safety 团队负责内容安全推理平台架构，日均处理 260 亿次模型推理请求，也由此开始系统接触 RAG 等 AI 工程化实践。</p>
        <p><strong>现在。</strong>目前正在创业，方向是 AIGC 短剧出海。从系统架构走向内容工程，关注如何把扩散模型、视频生成和语音合成组织成可重复、可追踪的工业化生产流程，并面向东南亚和印度市场进行本地化落地。</p>
      </section>
      <section>
        <h2>联系</h2>
        <ContactLinks />
      </section>
    </div>
  );
}
