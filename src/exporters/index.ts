/**
 * 平台导出器注册表
 * 
 * 统一管理所有平台的导出器，支持动态注册和调用
 */

import { PlatformExporter, Platform, RawData, UnifiedMetrics, ExportResult } from './types';
import { douyinExporter } from './douyin';
import { MeituanExporter, DEFAULT_MEITUAN_CONFIG } from './meituan';
import { AlipayExporter } from './alipay';

// 创建美团导出器实例
const meituanExporter = new MeituanExporter(DEFAULT_MEITUAN_CONFIG);
// 创建支付宝导出器实例
const alipayExporter = new AlipayExporter();

/** 导出器注册表 */
const exporterRegistry: Partial<Record<Platform, unknown>> = {
  douyin: douyinExporter,
  meituan: meituanExporter,
  alipay: alipayExporter,
  // 后续添加其他平台
  // wechat: wechatExporter,
  // kuaishou: kuaishouExporter,
  // xiaohongshu: xiaohongshuExporter,
};

/**
 * 注册新的平台导出器
 */
export function registerExporter(platform: Platform, exporter: PlatformExporter): void {
  exporterRegistry[platform] = exporter;
  console.log(` 已注册平台导出器：${platform}`);
}

/**
 * 获取平台导出器
 */
export function getExporter(platform: Platform): PlatformExporter | undefined {
  return exporterRegistry[platform] as PlatformExporter | undefined;
}

/**
 * 获取所有已注册的平台
 */
export function getRegisteredPlatforms(): Platform[] {
  return Object.keys(exporterRegistry) as Platform[];
}

/**
 * 执行单个平台导出
 */
export async function exportPlatform(platform: Platform): Promise<ExportResult> {
  const exporter = getExporter(platform);
  
  if (!exporter) {
    return {
      success: false,
      platform,
      accountId: 'unknown',
      timestamp: new Date().toISOString(),
      error: `平台 ${platform} 未注册导出器`
    };
  }
  
  try {
    console.log(`\n开始导出平台：${platform}`);
    
    // 导出原始数据
    const rawData = await exporter.export();
    
    // 转换为统一格式
    const unifiedData = await exporter.convertToUnified(rawData);
    
    // 保存结果
    const outputDir = './src/exporters/output';
    const outputFile = `${outputDir}/${platform}_unified_${Date.now()}.json`;
    
    import('fs').then(fs => {
      fs.writeFileSync(outputFile, JSON.stringify(unifiedData, null, 2));
      console.log(` 统一数据已保存：${outputFile}`);
    });
    
    return {
      success: true,
      platform,
      accountId: rawData.data.accountId || 'unknown',
      timestamp: rawData.timestamp,
      data: unifiedData,
      rawFile: `${outputDir}/${platform}_raw_${Date.now()}.json`,
      convertedFile: outputFile
    };
  } catch (error: any) {
    return {
      success: false,
      platform,
      accountId: 'unknown',
      timestamp: new Date().toISOString(),
      error: error.message
    };
  }
}

/**
 * 批量导出所有平台
 */
export async function exportAllPlatforms(): Promise<ExportResult[]> {
  const platforms = getRegisteredPlatforms();
  const results: ExportResult[] = [];
  
  console.log(`\n开始批量导出，共 ${platforms.length} 个平台`);
  
  for (const platform of platforms) {
    const result = await exportPlatform(platform);
    results.push(result);
  }
  
  return results;
}
