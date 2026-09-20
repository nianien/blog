import { getPostsByTag, getAllTags } from '@/lib/blog';
import BlogCard from '@/components/BlogCard';
import ListingLayout from '@/components/ListingLayout';
import Pagination from '@/components/Pagination';
import type { Metadata } from 'next';

const POSTS_PER_PAGE = 18;

export async function generateStaticParams() {
  const tags = getAllTags();
  const params = [];

  for (const tag of tags) {
    const posts = getPostsByTag(tag);
    const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);

    for (let page = 1; page <= totalPages; page++) {
      params.push({
        tag: tag,
        page: String(page),
      });
    }
  }

  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string; page: string }>;
}): Promise<Metadata> {
  const { tag, page } = await params;
  const decodedTag = decodeURIComponent(tag);
  const pageNum = parseInt(page) || 1;
  const pageSuffix = pageNum > 1 ? `（第 ${pageNum} 页）` : '';
  return {
    title: `标签：${decodedTag}${pageSuffix}`,
    description: `所有带 "${decodedTag}" 标签的文章`,
    alternates: {
      canonical: `/blog/tag/${encodeURIComponent(decodedTag)}/page/${pageNum}/`,
    },
  };
}

export default async function TagPageWithPagination({
  params
}: {
  params: Promise<{ tag: string; page: string }>
}) {
  const resolvedParams = await params;
  const { tag, page } = resolvedParams;
  const decodedTag = decodeURIComponent(tag);
  const currentPage = parseInt(page) || 1;

  const allPostsForTag = getPostsByTag(decodedTag);
  const totalPosts = allPostsForTag.length;
  const totalPages = Math.ceil(totalPosts / POSTS_PER_PAGE);
  const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
  const endIndex = startIndex + POSTS_PER_PAGE;
  const posts = allPostsForTag.slice(startIndex, endIndex);

  return (
    <ListingLayout currentTag={decodedTag} header={
      <header className="listing-heading"><h1 className="page-title">标签：{decodedTag}</h1><span>{totalPosts} 篇</span></header>
      }>
      <div className="post-list">
        {posts.map(post => <BlogCard key={post.slug} post={post} currentTag={decodedTag} />)}
      </div>
      {posts.length === 0 && <p className="empty-list">暂无文章</p>}
      <Pagination currentPage={currentPage} totalPages={totalPages} basePath={`/blog/tag/${encodeURIComponent(decodedTag)}/page`} />
    </ListingLayout>
  );
}
