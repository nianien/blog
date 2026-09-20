import Link from 'next/link';
import type { Metadata } from 'next';
import { getFeaturedPosts } from '@/lib/blog';
import BlogCard from '@/components/BlogCard';
import ListingLayout from '@/components/ListingLayout';

export const metadata: Metadata = {
  title: '精选文章',
  description: 'Skyfalling 精选技术文章',
  alternates: { canonical: '/featured/' },
};

export default function FeaturedPage() {
  const featuredPosts = getFeaturedPosts();

  return (
    <ListingLayout currentView="featured" header={
      <header className="listing-heading"><h1 className="page-title">精选文章</h1></header>
    }>
      <div className="post-list">
        {featuredPosts.map(post => <BlogCard key={post.slug} post={post} />)}
      </div>
      <div className="list-footer"><Link href="/blog/page/1/">浏览全部文章 →</Link></div>
    </ListingLayout>
  );
}
