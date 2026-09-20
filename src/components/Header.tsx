'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navigation = [
  { name: '文章', href: '/' },
  { name: '关于', href: '/about' },
];

export default function Header() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <nav className="site-nav" aria-label="主导航">
        <Link className="site-brand" href="/" aria-label="Skyfalling 首页">Skyfalling</Link>
        <div className="site-nav-links">
          {navigation.map(({ name, href }) => {
            const active = href === '/'
              ? pathname === '/' || pathname.startsWith('/featured') || pathname.startsWith('/blog')
              : pathname.startsWith(href);
            return <Link key={href} href={href} aria-current={active ? 'page' : undefined}>{name}</Link>;
          })}
        </div>
      </nav>
    </header>
  );
}
