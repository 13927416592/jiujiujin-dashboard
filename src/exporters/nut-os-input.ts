/**
 * OS 级硬件键鼠输入（仅在有图形界面的本机可用，典型场景：macOS 抓取机）。
 *
 * 背景：支付宝登录页 aliedit 安全控件会识别 CDP/Playwright 模拟按键并丢弃
 * （圆点显示但加密域为空、提交报"请输入登录密码"）。必须由操作系统层面
 * 合成真实硬件事件（macOS 上是 CGEvent → WindowServer），浏览器收到的事件
 * 才与物理按键完全一致，控件才会正常逐字符 RSA 加密。
 *
 * 本模块用 @nut-tree-fork/nut-js 投递事件，并在运行时动态 require：
 * - 在无图形环境（如云沙箱/Linux 无 X11）下原生库加载会失败，
 *   此时 isNutAvailable() 返回 false，调用方回退到其它方案，不影响构建。
 *
 * macOS 前置条件：
 *   系统设置 → 隐私与安全性 → 辅助功能：允许运行本脚本的终端/Node
 *   授权后需完全退出宿主 App 再重开才生效。
 */

// 运行时句柄，首次调用 ensureNut() 时填充。nut.js 含原生 .node，不能静态 import，
// 否则在无图形环境会导致整个模块加载失败。
type NutHandle = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nut: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyboard: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mouse: any;
};

let cached: NutHandle | null | undefined = undefined;

/**
 * 尝试加载 nut.js。返回句柄表示可用；返回 null 表示当前环境不可用
 * （未安装、无图形环境、缺少系统权限导致原生库加载失败等）。
 */
export function ensureNut(): NutHandle | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nut = require('@nut-tree-fork/nut-js');
    if (!nut || !nut.keyboard || !nut.mouse) {
      cached = null;
      return null;
    }
    // 节奏由调用方控制，关闭库自带的按键间延迟
    nut.keyboard.config.autoDelayMs = 0;
    cached = { nut, keyboard: nut.keyboard, mouse: nut.mouse };
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function isNutAvailable(): boolean {
  return ensureNut() !== null;
}

/**
 * 把指定 Chrome 窗口置顶（获得 OS 窗口焦点）。优先用 nut.js 的窗口 API
 * （走辅助功能权限），失败回退 AppleScript / open -a。
 * @returns 是否成功置顶
 */
export async function activateChrome(): Promise<boolean> {
  // 优先 AppleScript 激活 Chrome：只需要「自动化」权限，不依赖「屏幕录制」权限，
  // 也不会触发 nut.js getWindowTitle 的权限警告刷屏。
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('child_process');
    try {
      execSync('osascript -e \'tell application "Google Chrome" to activate\'', {
        timeout: 4000,
        stdio: 'ignore',
      });
      return true;
    } catch {
      execSync('open -a "Google Chrome"', { stdio: 'ignore' });
      return true;
    }
  } catch {
    /* AppleScript 不可用，回退 nut.js */
  }

  // 回退：nut.js 聚焦最大的可见窗口。注意：不要调 w.getTitle()，
  // 新版 macOS 上它需要「屏幕录制」权限，未授权时会刷屏警告。
  const handle = ensureNut();
  if (!handle) return false;
  try {
    const windows = await handle.nut.getWindows();
    let largest: unknown = null;
    let largestArea = 0;
    for (const w of windows) {
      const region = await w.getRegion().catch(() => null);
      if (!region || region.width < 400 || region.height < 400) continue;
      const area = region.width * region.height;
      if (area > largestArea) {
        largestArea = area;
        largest = w;
      }
    }
    if (largest) {
      await (largest as { focus: () => Promise<void> }).focus().catch(() => undefined);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * 读取最可能是支付宝登录窗口的左上角屏幕坐标。
 *
 * 优先用 AppleScript 直接读 Chrome 最前窗口 bounds（只需要"自动化"权限控制 Chrome，
 * 不需要屏幕录制权限，且坐标准确）。
 * 回退到 nut.js getWindows()（走辅助功能权限；新版 macOS 取其它 App 窗口标题/位置
 * 还需要"屏幕录制"权限，未授权时会返回空标题和 (0,0) 并刷屏警告，仅作兜底）。
 */
export async function getChromeWindowOrigin(): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  via: 'osascript' | 'nut';
} | null> {
  // 1) AppleScript 读 Chrome 最前窗口 bounds：返回 "x, y, width, height"
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('child_process');
    const out = execSync(
      'osascript -e \'tell application "Google Chrome" to get bounds of front window\'',
      { timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();
    const parts = out.split(/\s*,\s*/).map((s: string) => parseInt(s, 10));
    if (parts.length === 4 && parts.every((n: number) => Number.isFinite(n)) && parts[2] > 400) {
      return {
        x: parts[0],
        y: parts[1],
        width: parts[2],
        height: parts[3],
        title: 'chrome-front-window',
        via: 'osascript',
      };
    }
  } catch {
    /* AppleScript 被拒/无 Chrome 窗口，回退 nut.js */
  }

  // 2) 回退 nut.js 枚举窗口（可能需要屏幕录制权限）
  const handle = ensureNut();
  if (!handle) return null;
  try {
    const windows = await handle.nut.getWindows();
    const candidates: Array<{
      title: string;
      left: number;
      top: number;
      width: number;
      height: number;
      area: number;
    }> = [];
    for (const w of windows) {
      const region = await w.getRegion().catch(() => null);
      if (!region || region.width < 400 || region.height < 400) continue;
      // 不调 getTitle()：它在未授权屏幕录制时会刷屏警告。直接用 region 匹配。
      candidates.push({
        title: '',
        left: region.left,
        top: region.top,
        width: region.width,
        height: region.height,
        area: region.width * region.height,
      });
    }
    const match = candidates.sort((a, b) => b.area - a.area)[0];
    if (!match) return null;
    return {
      x: match.left,
      y: match.top,
      width: match.width,
      height: match.height,
      title: match.title,
      via: 'nut',
    };
  } catch {
    return null;
  }
}

/**
 * OS 级仅移动鼠标到屏幕坐标（不点击）。用于运行时自动校准 Chrome 外壳偏移。
 */
export async function osMoveMouse(x: number, y: number): Promise<void> {
  const handle = ensureNut();
  if (!handle) throw new Error('nut.js 不可用');
  await handle.mouse.setPosition({ x, y });
  await new Promise((r) => setTimeout(r, 250));
}

/**
 * OS 级鼠标移动到屏幕坐标并左键单击（把 OS 键盘焦点真正送进网页内容区）。
 */
export async function osClickScreen(x: number, y: number): Promise<void> {
  const handle = ensureNut();
  if (!handle) throw new Error('nut.js 不可用');
  // Point 是 {x,y} 简单接口，直接传普通对象即可
  await handle.mouse.setPosition({ x, y });
  await new Promise((r) => setTimeout(r, 300));
  await handle.mouse.leftClick();
  await new Promise((r) => setTimeout(r, 800));
}

/**
 * OS 级按一次 Tab（用于在网页内把 DOM 焦点从账号框切到密码框，且必须是硬件级）。
 */
export async function osPressTab(): Promise<void> {
  const handle = ensureNut();
  if (!handle) throw new Error('nut.js 不可用');
  await handle.keyboard.type(handle.nut.Key.Tab);
  await new Promise((r) => setTimeout(r, 300));
}

/**
 * OS 级逐字符输入密码，字符间加 60~150ms 随机延迟模拟真人节奏。
 * 注意：期间用户不能动鼠标键盘，否则焦点可能被抢走导致串框。
 */
export async function osTypePassword(password: string): Promise<void> {
  const handle = ensureNut();
  if (!handle) throw new Error('nut.js 不可用');
  for (const ch of password) {
    await handle.keyboard.type(ch);
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 90));
  }
  await new Promise((r) => setTimeout(r, 400));
}
