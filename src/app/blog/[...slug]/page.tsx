import { articlePathname } from '@/lib/content-paths';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { getPostWithNavigation, getCategoryFromSlug, getSeriesMeta, getSeriesNavItems } from '@/lib/blog';
import { CATEGORY_META } from '@/lib/categories';
import { SITE, absoluteUrl } from '@/lib/site';
import SyntaxHighlightedContent from '@/components/SyntaxHighlightedContent';
import BlogPostNavigation from '@/components/BlogPostNavigation';
import SeriesNav from '@/components/SeriesNav';
import GiscusComments from '@/components/GiscusComments';
import { Suspense } from 'react';
import { buildArticleOutline } from '@/lib/article-outline';
import type { Metadata } from 'next';

export async function generateStaticParams() {
  const { getAllPosts } = await import('@/lib/blog');
  const posts = getAllPosts();
  const params = [];
  
  // 为每个文章生成参数
  for (const post of posts) {
    // 直接使用中文路径
    params.push({
      slug: post.slug.split('/'),
    });
  }
  
  return params;
}

export async function generateMetadata({ 
  params 
}: { 
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const slugString = slug.join('/');
  
  const postData = getPostWithNavigation(slugString);
  if (!postData) {
    return {
      title: '页面未找到',
      description: '请求的页面不存在',
    };
  }

  const { post } = postData;
  const canonicalPath = articlePathname(post.slug, process.env.NEXT_PUBLIC_BASE_PATH);
  const canonicalUrl = absoluteUrl(canonicalPath);
  const ogImage = post.heroImage || SITE.defaultOgImage;

  return {
    title: post.title,
    description: post.description || post.title,
    keywords: post.tags,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title: post.title,
      description: post.description || post.title,
      type: 'article',
      url: canonicalUrl,
      siteName: SITE.name,
      locale: SITE.locale,
      publishedTime: post.pubDate,
      modifiedTime: post.pubDate,
      authors: [SITE.author],
      tags: post.tags,
      images: [{ url: ogImage }],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description || post.title,
      images: [ogImage],
    },
  };
}

export default async function BlogPostPage({ 
  params
}: { 
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const slugString = slug.join('/');
  
  const postData = getPostWithNavigation(slugString);
  if (!postData) {
    notFound();
  }

  const { post, globalNav, tagNav } = postData;

  // 分类面包屑
  const categoryPath = getCategoryFromSlug(post.slug);
  const categoryParts = categoryPath.split('/');
  const mainCategory = categoryParts[0];
  const mainMeta = CATEGORY_META[mainCategory];
  const subMeta = CATEGORY_META[categoryPath];

  const canonicalUrl = absoluteUrl(articlePathname(post.slug, process.env.NEXT_PUBLIC_BASE_PATH));
  const ogImage = post.heroImage || SITE.defaultOgImage;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description || post.title,
    datePublished: post.pubDate,
    dateModified: post.pubDate,
    inLanguage: SITE.locale,
    keywords: post.tags?.join(', '),
    author: {
      '@type': 'Person',
      name: SITE.author,
      url: SITE.url,
    },
    publisher: {
      '@type': 'Person',
      name: SITE.author,
      url: SITE.url,
    },
    image: absoluteUrl(ogImage),
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': canonicalUrl,
    },
    url: canonicalUrl,
    articleSection: mainMeta?.name || mainCategory,
  };

  const outline = buildArticleOutline(post.content);
  const seriesMeta = post.series?.key ? getSeriesMeta(post.series.key) : null;
  const seriesItems = post.series?.key ? getSeriesNavItems(post.series.key, post.slug) : [];
  const hasSeries = seriesMeta && seriesItems.length > 1;

  return (
    <article className="article-shell page-space">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <header className="article-header">
        <nav className="breadcrumbs" aria-label="文章位置">
          <Link href="/blog/page/1">博客</Link><span aria-hidden="true">/</span>
          <Link href={`/blog/category/${mainCategory}/page/1`}>{mainMeta?.name || mainCategory}</Link>
          {categoryParts.length > 1 && subMeta && <><span aria-hidden="true">/</span><Link href={`/blog/category/${categoryPath}/page/1`}>{subMeta.name}</Link></>}
        </nav>
        <h1>{post.title}</h1>
        <div className="article-meta">
          <time dateTime={post.pubDate}>{format(new Date(post.pubDate), 'yyyy年MM月dd日', { locale: zhCN })}</time>
          {hasSeries && <a href="#article-series">{seriesMeta.name}</a>}
        </div>
        {post.tags && post.tags.length > 0 && <nav className="article-tags" aria-label="文章标签">
          {post.tags.map(tag => <Link key={tag} href={`/blog/tag/${encodeURIComponent(tag)}/page/1/`}>{tag}</Link>)}
        </nav>}
      </header>
      {outline.items.length >= 4 && (
        <details className="article-outline">
          <summary>目录</summary>
          <nav aria-label="文章目录"><ol>{outline.items.map(item => <li key={item.id}><a href={`#${encodeURIComponent(item.id)}`}>{item.title}</a></li>)}</ol></nav>
        </details>
      )}
      <div className="article-content"><SyntaxHighlightedContent content={outline.content} /></div>
      <div className="article-ending">
        {hasSeries && <div id="article-series"><SeriesNav meta={seriesMeta} items={seriesItems} /></div>}
        <Suspense fallback={null}><BlogPostNavigation globalNav={globalNav} tagNav={tagNav} /></Suspense>
        <GiscusComments />
      </div>
    </article>
  );
}
