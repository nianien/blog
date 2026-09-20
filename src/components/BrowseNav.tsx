import Link from 'next/link';
import { getAllPosts, getFeaturedPosts, getLatestPosts } from '@/lib/blog';
import { type BrowseView } from '@/lib/article-browse';

export default function BrowseNav({ currentView }: { currentView?: BrowseView }) {
  const allPosts = getAllPosts();
  const latestCount = getLatestPosts(allPosts).length;
  const featuredCount = getFeaturedPosts(allPosts).length;
  const links: Array<{ view: BrowseView; label: string; href: string; count: number }> = [
    { view: 'latest', label: '最新', href: '/', count: latestCount },
    { view: 'featured', label: '精选', href: '/featured/', count: featuredCount },
  ];

  return (
    <nav className="browse-nav" aria-label="文章浏览方式">
      <div className="sidebar-section-heading">速览</div>
      <div className="browse-nav-list">
        {links.map(link => (
          <Link key={link.view} href={link.href} aria-current={currentView === link.view ? 'page' : undefined}>
            <span>{link.label}</span><span className="category-count">({link.count})</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
