import { getAllPosts } from '@/lib/blog';
import BlogCard from '@/components/BlogCard';
import ListingLayout from '@/components/ListingLayout';
import Pagination from '@/components/Pagination';
import type { Metadata } from 'next';

const POSTS_PER_PAGE = 18;

export async function generateStaticParams() {
  const allPosts = getAllPosts();
  const totalPages = Math.ceil(allPosts.length / POSTS_PER_PAGE);
  return Array.from({ length: totalPages }, (_, i) => ({ page: String(i + 1) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string }>;
}): Promise<Metadata> {
  const { page } = await params;
  const pageNum = parseInt(page) || 1;
  const pageSuffix = pageNum > 1 ? `（第 ${pageNum} 页）` : '';
  return {
    title: `全部文章${pageSuffix}`,
    description: '所有博客文章列表',
    alternates: {
      canonical: `/blog/page/${pageNum}/`,
    },
  };
}

export default async function BlogPage({ params }: { params: Promise<{ page: string }> }) {
  const resolvedParams = await params;
  const currentPage = resolvedParams.page ? parseInt(resolvedParams.page) : 1;
  const allPosts = getAllPosts();
  const totalPosts = allPosts.length;
  const totalPages = Math.ceil(totalPosts / POSTS_PER_PAGE);
  const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
  const endIndex = startIndex + POSTS_PER_PAGE;
  const posts = allPosts.slice(startIndex, endIndex);

  return (
    <ListingLayout currentView="all" header={
      <header className="listing-heading"><h1 className="page-title">全部文章</h1><span>{totalPosts} 篇</span></header>
      }>
      <div className="post-list">
        {posts.map(post => <BlogCard key={post.slug} post={post} />)}
      </div>
      <Pagination currentPage={currentPage} totalPages={totalPages} basePath="/blog/page" />
    </ListingLayout>
  );
}
