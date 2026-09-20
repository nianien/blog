import Link from 'next/link';
import type { Metadata } from 'next';
import { getLatestPosts } from '@/lib/blog';
import BlogCard from '@/components/BlogCard';
import ListingLayout from '@/components/ListingLayout';

export const metadata: Metadata = {
  title: '最新文章',
  description: 'Skyfalling 的最新技术文章与思考',
  alternates: { canonical: '/' },
};

export default function Home() {
  const latestPosts = getLatestPosts();

  return (
    <ListingLayout currentView="latest" header={
      <header className="listing-heading"><h1 className="page-title">最新文章</h1></header>
    }>
      <div className="post-list">
        {latestPosts.map(post => <BlogCard key={post.slug} post={post} />)}
      </div>
      <div className="list-footer"><Link href="/blog/page/1/">浏览全部文章 →</Link></div>
    </ListingLayout>
  );
}
