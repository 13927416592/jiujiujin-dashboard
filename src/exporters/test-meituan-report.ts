import { exportMeituanData } from './meituan';

async function main() {
  console.log('=== 美团报表下载测试 ===\n');
  
  try {
    const result = await exportMeituanData({
      headless: false,  // 显示浏览器，方便调试
    });
    
    console.log('\n✅ 导出成功！');
    console.log('平台:', result.platform);
    console.log('时间:', result.timestamp);
    console.log('数据:', JSON.stringify(result.data, null, 2));
  } catch (error) {
    console.error('\n❌ 导出失败:', error);
  }
}

main();
