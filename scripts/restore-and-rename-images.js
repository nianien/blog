const fs = require('fs');
const path = require('path');

const businessDir = path.join(process.cwd(), 'public/images/blog/tech/business');

// 恢复原始文件名
function restoreOriginalNames() {
  const files = fs.readdirSync(businessDir);
  const imgFiles = files
    .filter(file => file.startsWith('img_') && file.endsWith('.png'))
    .sort((a, b) => {
      const numA = parseInt(a.replace('img_', '').replace('.png', ''));
      const numB = parseInt(b.replace('img_', '').replace('.png', ''));
      return numA - numB;
    });

  console.log('当前文件:');
  imgFiles.forEach(file => console.log(`  ${file}`));

  // 恢复为原始格式
  console.log('\n恢复原始文件名...');
  imgFiles.forEach((file, index) => {
    const originalName = `img_20250723_${String(index + 1).padStart(2, '0')}.png`;
    const oldPath = path.join(businessDir, file);
    const newPath = path.join(businessDir, originalName);
    
    if (file !== originalName) {
      fs.renameSync(oldPath, newPath);
      console.log(`  ${file} -> ${originalName}`);
    }
  });
}

// 从第24个开始重命名
function renameFrom24() {
  const files = fs.readdirSync(businessDir);
  const imgFiles = files
    .filter(file => file.startsWith('img_20250723_') && file.endsWith('.png'))
    .sort((a, b) => {
      const numA = parseInt(a.replace('img_20250723_', '').replace('.png', ''));
      const numB = parseInt(b.replace('img_20250723_', '').replace('.png', ''));
      return numA - numB;
    });

  console.log('\n从第24个开始重命名...');
  
  imgFiles.forEach((file, index) => {
    const fileNumber = parseInt(file.replace('img_20250723_', '').replace('.png', ''));
    
    if (fileNumber >= 24) {
      const newName = `img_${String(index + 1).padStart(2, '0')}.png`;
      const oldPath = path.join(businessDir, file);
      const newPath = path.join(businessDir, newName);
      
      fs.renameSync(oldPath, newPath);
      console.log(`  ${file} -> ${newName}`);
    }
  });
}

// 执行重命名
function main() {
  console.log('开始处理图片重命名...\n');
  
  restoreOriginalNames();
  renameFrom24();
  
  console.log('\n重命名完成！');
  
  // 显示最终结果
  const finalFiles = fs.readdirSync(businessDir)
    .filter(file => file.startsWith('img_') && file.endsWith('.png'))
    .sort();
  
  console.log('\n最终文件列表:');
  finalFiles.forEach(file => console.log(`  ${file}`));
}

main(); 