import Link from 'next/link';
import { SeriesNavItem, SeriesMeta } from '@/types/blog';

interface SeriesNavProps {
  meta: SeriesMeta;
  items: SeriesNavItem[];
}

export default function SeriesNav({ meta, items }: SeriesNavProps) {
  if (items.length <= 1) return null;

  return (
    <nav className="series-navigation" aria-label="系列文章">
      <div className="series-content">
        <h2 className="text-base font-semibold text-gray-900 mb-1">
          {meta.name}
        </h2>
        {meta.description && (
          <p className="text-sm text-gray-500 mb-4">{meta.description}</p>
        )}
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.slug}>
              {item.isCurrent ? (
                <span aria-current="page" className="inline-flex items-center text-sm font-semibold text-gray-900">
                  <span className="w-1.5 h-1.5 bg-blue-600 rounded-full mr-3 flex-shrink-0" />
                  {item.title}
                </span>
              ) : (
                <Link
                  href={`/blog/${encodeURI(item.slug)}`}
                  className="inline-flex items-center text-sm text-gray-600 hover:text-blue-600 transition-colors"
                >
                  <span className="w-1.5 h-1.5 bg-gray-300 rounded-full mr-3 flex-shrink-0" />
                  {item.title}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
