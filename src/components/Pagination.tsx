import Link from 'next/link';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  basePath: string;
}

export default function Pagination({ currentPage, totalPages, basePath }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label="文章分页">
      {currentPage > 1 && <Link href={`${basePath}/${currentPage - 1}`}>上一页</Link>}
      {Array.from({ length: totalPages }, (_, index) => index + 1).map(page => (
        <Link key={page} href={`${basePath}/${page}`} aria-label={`第 ${page} 页`}
          aria-current={page === currentPage ? 'page' : undefined}>{page}</Link>
      ))}
      {currentPage < totalPages && <Link href={`${basePath}/${currentPage + 1}`}>下一页</Link>}
    </nav>
  );
}
