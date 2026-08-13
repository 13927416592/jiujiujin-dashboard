# 美团报表下载配置指南

## 概述

美团经营宝已创建自定义报表"久久金美团经营数据"，包含 37 个数据指标，每日更新。

## 报表信息

- **报表名称**: 久久金美团经营数据
- **时间周期**: 每日
- **统计对象**: 门店-单门店
- **数据指标**: 37 个

## 数据指标清单

### 基础信息
- 日期
- 省份
- 城市
- 门店 ID
- 门店名称

### 运营成本
- 推广通消耗金额
- 商户通发布额

### 客流分析
- 曝光人数
- 曝光次数
- 访问人数
- 访问次数
- 曝光访问转化率
- 意向转化人数
- 意向转化率
- 下单人数
- 留资人数
- 累计收藏人数
- 新增收藏人数
- 人均停留时长

### 交易分析
- 核销金额
- 核销团购券数
- 核销订单量
- 核销人次

### 咨询分析
- 在线咨询人数
- 新增留资人数
- 平均首次响应时长
- 平均响应时长
- 回复率

### 评价分析
- 新增评价数
- 新增好评数
- 新增中评数
- 新增差评数
- 差评回复率

## 配置步骤

### 1. 确认报表中心 URL

登录美团经营宝后，进入报表中心，复制当前 URL。

格式通常为：
```
https://e.dianping.com/#/report-center
```

或带有报表 ID：
```
https://e.dianping.com/#/report/xxx
```

### 2. 更新配置文件

编辑 `src/exporters/meituan.ts`，更新 `reportUrl`：

```typescript
export const DEFAULT_MEITUAN_CONFIG: MeituanExportConfig = {
  baseUrl: 'https://e.dianping.com/',
  reportUrl: 'https://e.dianping.com/#/report-center',  // 替换为实际 URL
  // ...
};
```

### 3. 测试运行

```bash
cd /workspace/projects
npx tsx src/exporters/test-meituan-report.ts
```

### 4. 首次登录

- 浏览器自动打开
- 输入手机号 `13927416592`
- 输入验证码登录
- Cookie 自动保存

### 5. 验证数据

检查输出文件：
```bash
ls -la src/exporters/output/
cat src/exporters/output/meituan_full_*.json | jq '.data'
```

## 定时任务

### macOS (launchd)

```bash
# 复制配置文件
cp scripts/com.jiujiujin.meituan-daily.plist ~/Library/LaunchAgents/

# 加载定时任务
launchctl load ~/Library/LaunchAgents/com.jiujiujin.meituan-daily.plist

# 验证
launchctl list | grep meituan
```

### Linux (cron)

```bash
# 编辑 crontab
crontab -e

# 添加每日 9 点执行
0 9 * * * cd /workspace/projects && npx tsx src/exporters/test-meituan-report.ts >> /tmp/meituan.log 2>&1
```

## 数据格式

### JSON 格式
```json
{
  "platform": "meituan",
  "timestamp": "2026-08-13T10:00:00.000Z",
  "data": {
    "2026-08-12": {
      "久久金管家·黄金首饰回收 (北京公益西桥华联店)": {
        "运营成本": { "推广通消耗金额": 0, "商户通发布额": 0 },
        "客流分析": { "曝光人数": 268, "访问人数": 36 },
        // ...
      }
    }
  }
}
```

### Excel 格式
- 位置：`src/exporters/output/meituan_report_YYYY-MM-DD.xlsx`
- 包含所有原始数据

## 故障排查

### Cookie 过期
```bash
# 删除旧 Cookie
rm src/exporters/cookies/meituan.json

# 重新登录
npx tsx src/exporters/test-meituan-report.ts
```

### 报表 URL 变更
1. 登录美团经营宝
2. 进入报表中心
3. 复制最新 URL
4. 更新配置文件

### 数据缺失
1. 检查报表是否包含该指标
2. 检查门店是否选择正确
3. 检查时间范围是否正确

## 注意事项

1. **Cookie 有效期**: 约 7 天，过期后需重新登录
2. **报表更新**: 每日数据通常在次日凌晨更新
3. **网络要求**: 需要稳定的网络连接
4. **浏览器**: 使用 Chromium（Playwright 内置）

## 相关文件

- `src/exporters/meituan.ts` - 导出器实现
- `src/exporters/test-meituan-report.ts` - 测试脚本
- `src/app/api/data/meituan/export/route.ts` - API 接口
- `scripts/meituan-daily.sh` - 定时任务脚本
- `docs/meituan-scheduler.md` - 调度配置文档
