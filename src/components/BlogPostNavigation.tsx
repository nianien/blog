'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { NavigationInfo } from '@/types/blog';

interface BlogPostNavigationProps {
  globalNav: NavigationInfo;
  tagNav: Record<string, NavigationInfo>;
}

export default function BlogPostNavigation({ 
  globalNav, 
  tagNav
}: BlogPostNavigationProps) {
  const searchParams = useSearchParams();
  const tagContext = searchParams.get('tag');

  // 根据标签上下文选择导航
  const nav = tagContext && tagNav[tagContext] 
    ? tagNav[tagContext] 
    : globalNav;

  return (
    <nav className="mt-12 pt-8 border-t border-gray-200">
      <div className="flex justify-between items-center">
        {nav.prev && (
          <Link
            href={`/blog/${encodeURIComponent(nav.prev.slug)}${tagContext ? `?tag=${encodeURIComponent(tagContext)}` : ''}`}
            className="group flex items-center max-w-xs p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all duration-200"
          >
            <svg className="w-5 h-5 mr-3 text-gray-400 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <div className="min-w-0">
              <div className="text-xs text-gray-500 mb-1">上一篇</div>
              <div className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors truncate">
                {nav.prev.title}
              </div>
            </div>
          </Link>
        )}
        
        {!nav.prev && <div></div>}
        
        {nav.next && (
          <Link
            href={`/blog/${encodeURIComponent(nav.next.slug)}${tagContext ? `?tag=${encodeURIComponent(tagContext)}` : ''}`}
            className="group flex items-center max-w-xs p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all duration-200"
          >
            <div className="min-w-0">
              <div className="text-xs text-gray-500 mb-1">下一篇</div>
              <div className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors truncate">
                {nav.next.title}
              </div>
            </div>
            <svg className="w-5 h-5 ml-3 text-gray-400 group-hover:text-blue-600 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
        
        {!nav.next && <div></div>}
      </div>
    </nav>
  );
} 