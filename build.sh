#!/usr/bin/env sh
publish_branch="gitbook"
publish_source="books"
publish_dir="docs"

git branch -D "$publish_branch"
git checkout --orphan  "$publish_branch"


for file in "$publish_source"/*; do
  gitbook build "$file" docs/"${file##*/}"
done

for file in $(find "$publish_dir" -name '*.html'); do
  echo "$file"
  sed -i "" "s|.gitbook/assets/|gitbook/assets/|" "$file"
done
for file in "$publish_dir"/*; do
  if [ -d "$file/.gitbook/assets" ]; then
    mv "$file/.gitbook/assets" "$file/gitbook/assets"
  fi
done

git rm -rf .github
git rm -rf build.sh
git add .
git commit -m"gitbook build"
git push --force origin "$publish_branch"
git checkout master