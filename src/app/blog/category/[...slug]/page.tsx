import { redirect } from 'next/navigation';
import { getPostsByCategory, getAllCategories } from '@/lib/blog';
import { CATEGORY_META, MAIN_CATEGORIES } from '@/lib/categories';
import BlogCard from '@/components/BlogCard';
import ListingLayout from '@/components/ListingLayout';
import Link from 'next/link';
import Pagination from '@/components/Pagination';
import type { Metadata } from 'next';

const POSTS_PER_PAGE = 18;

// Parse slug segments into categoryPath and page number
// e.g. ["engineering", "agentic", "page", "1"] → { categoryPath: "engineering/agentic", page: 1 }
// e.g. ["engineering", "page", "1"] → { categoryPath: "engineering", page: 1 }
// e.g. ["engineering"] → redirect needed
function parseSlug(slug: string[]): { categoryPath: string; page: number } | null {
  const pageIndex = slug.indexOf('page');
  if (pageIndex === -1) {
    return null; // needs redirect
  }
  const categoryPath = slug.slice(0, pageIndex).join('/');
  const page = parseInt(slug[pageIndex + 1]) || 1;
  return { categoryPath, page };
}

export async function generateStaticParams() {
  const categories = getAllCategories();
  const params: Array<{ slug: string[] }> = [];

  // Sub-category pages
  for (const cat of categories) {
    const posts = getPostsByCategory(cat.path);
    const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
    const parts = cat.path.split('/');
    for (let page = 1; page <= totalPages; page++) {
      params.push({ slug: [...parts, 'page', String(page)] });
    }
    // Bare path redirect entry
    params.push({ slug: parts });
  }

  // Main category pages
  for (const main of MAIN_CATEGORIES) {
    const posts = getPostsByCategory(main);
    const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
    for (let page = 1; page <= totalPages; page++) {
      params.push({ slug: [main, 'page', String(page)] });
    }
    // Bare path redirect entry
    params.push({ slug: [main] });
  }

  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  const categoryPath = parsed?.categoryPath || slug.join('/');
  const page = parsed?.page || 1;
  const meta = CATEGORY_META[categoryPath];
  const name = meta?.name || categoryPath;
  const pageSuffix = page > 1 ? `（第 ${page} 页）` : '';

  return {
    title: `${name}${pageSuffix}`,
    description: meta?.description || `${name}分类下的文章`,
    alternates: {
      canonical: `/blog/category/${categoryPath}/page/${page}/`,
    },
    openGraph: {
      title: `${name}${pageSuffix}`,
      description: meta?.description || `${name}分类下的文章`,
      type: 'website',
      url: `/blog/category/${categoryPath}/page/${page}/`,
    },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const parsed = parseSlug(slug);

  // If no /page/N in URL, redirect to page 1
  if (!parsed) {
    const categoryPath = slug.join('/');
    redirect(`/blog/category/${categoryPath}/page/1`);
  }

  const { categoryPath, page: currentPage } = parsed;

  const allPostsForCategory = getPostsByCategory(categoryPath);
  const totalPosts = allPostsForCategory.length;
  const totalPages = Math.ceil(totalPosts / POSTS_PER_PAGE);
  const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
  const endIndex = startIndex + POSTS_PER_PAGE;
  const posts = allPostsForCategory.slice(startIndex, endIndex);

  return (
    <ListingLayout currentCategory={categoryPath} header={
      <header className="listing-heading">
        <h1 className="page-title">{CATEGORY_META[categoryPath]?.name || categoryPath}</h1>
        <span>{totalPosts} 篇</span>
      </header>
      }>
      <div className="post-list">
        {posts.map(post => <BlogCard key={post.slug} post={post} />)}
      </div>
      {posts.length === 0 && <p className="empty-list">暂无文章。<Link href="/blog/page/1">全部文章</Link></p>}
      <Pagination currentPage={currentPage} totalPages={totalPages} basePath={`/blog/category/${categoryPath}/page`} />
    </ListingLayout>
  );
}
