import { getAllCategories } from '@/lib/blog';
import { CATEGORY_META, MAIN_CATEGORIES } from '@/lib/categories';
import CategoryTree from '@/components/CategoryTree';

export default function CategoryNav({ currentCategory, allActive = false }: { currentCategory?: string; allActive?: boolean }) {
  const categories = getAllCategories();
  const activeMain = currentCategory?.split('/')[0];
  const categoryOrder = Object.keys(CATEGORY_META);
  const orderedCategories = categories.filter(c => c.sub)
    .sort((a, b) => categoryOrder.indexOf(a.path) - categoryOrder.indexOf(b.path));
  const mainCounts: Record<string, number> = {};
  let totalCount = 0;
  for (const category of categories) {
    mainCounts[category.main] = (mainCounts[category.main] || 0) + category.count;
    totalCount += category.count;
  }

  const groups = MAIN_CATEGORIES.map(key => ({
    key,
    name: CATEGORY_META[key].name,
    count: mainCounts[key] || 0,
    children: orderedCategories.filter(category => category.main === key).map(category => ({
      path: category.path,
      name: category.name,
      count: category.count,
    })),
  }));

  return <CategoryTree key={activeMain || 'all'} groups={groups} totalCount={totalCount}
    currentCategory={currentCategory} allActive={allActive} />;
}
