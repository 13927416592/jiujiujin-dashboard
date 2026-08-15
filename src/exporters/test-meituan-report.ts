import { MeituanExporter } from './meituan';
import * as path from 'path';

async function main() {
  console.log('=== 美团报表下载测试 ===\n');

  const exporter = new MeituanExporter({
    headless: false,
    slowMo: 1000,
    outputDir: path.join(process.cwd(), 'src', 'exporters', 'output'),
    cookiePath: path.join(process.cwd(), 'src', 'exporters', 'cookies', 'meituan.json'),
    daysToDownload: 1, // 每天下载 1 天数据
  });

  const result = await exporter.export();

  console.log('\n=== 结果 ===');
  console.log('成功:', result.success);
  if (result.success) {
    console.log('数据条数:', (result.data as any[])?.length || 0);
    console.log('文件路径:', result.filePath);
  } else {
    console.log('错误:', result.error);
  }
}

main().catch(console.error);
