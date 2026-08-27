"""
SmartBI 完成订单报表每日自动导出 + 回传看板。

每天执行：登录 → 打开「yxd-门店每日完成订单统计」→ 设日期为昨天 → 导出 Excel
         → multipart 上传到看板 /api/orders/upload（日度整日替换，幂等）。

凭据/配置全部从环境变量读取，禁止硬编码：
  SMARTBI_USERNAME              SmartBI 登录账号（如 叶旭栋）
  SMARTBI_PASSWORD              SmartBI 登录密码
  DASHBOARD_ORDERS_UPLOAD_URL   看板基址，如 https://dashboard.example.com（不带尾斜杠）
  DASHBOARD_INGEST_TOKEN        看板上传共享密钥（X-Upload-Token）
  SMARTBI_DOWNLOAD_DIR          下载目录，默认 ./smartbi_downloads
  SMARTBI_HEADLESS              "0" 用有头模式（默认 1 无头）

退出码：0 成功；1 配置缺失/登录失败；2 导出失败；3 回传看板失败。
失败时若有飞书告警脚本（scripts/feishu-alert.sh）会自动调用。
"""
import asyncio
import os
import sys
import glob
import uuid
import json
import mimetypes
import traceback
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = "https://bi.9999jt.com:18080/smartbi/vision/index.jsp#/modelquery"
REPORT_NAME = "门店每日完成订单统计"

USERNAME = os.environ.get("SMARTBI_USERNAME", "")
PASSWORD = os.environ.get("SMARTBI_PASSWORD", "")
UPLOAD_BASE = os.environ.get("DASHBOARD_ORDERS_UPLOAD_URL", "").rstrip("/")
INGEST_TOKEN = os.environ.get("DASHBOARD_INGEST_TOKEN", "")
DOWNLOAD_DIR = os.environ.get(
    "SMARTBI_DOWNLOAD_DIR",
    str(Path(__file__).resolve().parent / "smartbi_downloads"),
)
HEADLESS = os.environ.get("SMARTBI_HEADLESS", "1") != "0"

PROJECT_DIR = str(Path(__file__).resolve().parent.parent.parent)
FEISHU_SCRIPT = os.path.join(PROJECT_DIR, "scripts", "feishu-alert.sh")


def alert(msg: str) -> None:
    """失败时尝试调用飞书告警脚本（不存在或失败都不影响主流程）。"""
    print(f"[ALERT] {msg}", file=sys.stderr)
    if os.path.exists(FEISHU_SCRIPT) and os.access(FEISHU_SCRIPT, os.X_OK):
        try:
            import subprocess
            subprocess.run([FEISHU_SCRIPT, msg], timeout=30, check=False)
        except Exception as e:  # noqa: BLE001
            print(f"飞书告警调用失败: {e}", file=sys.stderr)


def yesterday_str() -> str:
    return (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")


async def login(page) -> bool:
    print("1. 打开登录页...")
    await page.goto(BASE_URL, timeout=60000)
    await page.wait_for_timeout(5000)
    print("2. 填写账号密码...")
    inputs = await page.query_selector_all("input")
    if len(inputs) < 4:
        print(f"   登录页输入框数量异常: {len(inputs)}")
        return False
    await inputs[0].fill(USERNAME)
    await inputs[1].fill(PASSWORD)
    await inputs[3].click()
    print("   点击登录，等待跳转...")
    await page.wait_for_timeout(8000)
    if "modelquery" in page.url:
        print("   登录成功")
        return True
    await page.screenshot(path=os.path.join(DOWNLOAD_DIR, "login_failed.png"))
    return False


async def navigate_to_report(page) -> bool:
    print("3. 搜索报表...")
    si = await page.query_selector("span[qtp='BannerView-global-search-icon'], .search-item")
    if si:
        await si.click()
        await page.wait_for_timeout(1000)
    sb = await page.query_selector("input[placeholder*='搜索'], input[type='search']")
    if not sb:
        sb = await page.query_selector("input")
    if sb:
        await sb.click()
        await page.keyboard.type(REPORT_NAME, delay=50)
        await page.wait_for_timeout(2000)
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(3000)
    results = await page.query_selector_all(f"text={REPORT_NAME}")
    for r in results:
        if await r.is_visible():
            await r.click()
            await page.wait_for_timeout(5000)
            print("   打开报表成功")
            return True
    print("   未找到报表")
    return False


def _locate_date_input(frame, action: str):
    """在 iframe 内按行标签「年月日」定位可见可写的日期输入框。
    action='value' 读值；'click' 点击聚焦。"""
    js_click = """
        () => {
            const rows = document.querySelectorAll('.base-query-filter');
            for (const row of rows) {
                const nameInput = row.querySelector('.base-query-filter_name input');
                if (nameInput && nameInput.value === '年月日') {
                    const vc = row.querySelector('.base-query-filter_value');
                    if (!vc) continue;
                    const inputs = vc.querySelectorAll('input');
                    for (const inp of inputs) {
                        if (inp.offsetParent !== null && !inp.readOnly &&
                            !inp.className.includes('el-select__input')) {
                            inp.click(); inp.focus(); return true;
                        }
                    }
                }
            }
            return false;
        }
    """
    js_value = """
        () => {
            const rows = document.querySelectorAll('.base-query-filter');
            for (const row of rows) {
                const nameInput = row.querySelector('.base-query-filter_name input');
                if (nameInput && nameInput.value === '年月日') {
                    const vc = row.querySelector('.base-query-filter_value');
                    if (!vc) continue;
                    const inputs = vc.querySelectorAll('input');
                    for (const inp of inputs) {
                        if (inp.offsetParent !== null && !inp.readOnly &&
                            !inp.className.includes('el-select__input')) {
                            return inp.value || '';
                        }
                    }
                }
            }
            // fallback: 任意日期格式 input
            const allInputs = document.querySelectorAll('input.el-input__inner');
            for (const inp of allInputs) {
                if (/^\\d{4}-\\d{2}-\\d{2}$/.test(inp.value || '')) return inp.value;
            }
            return null;
        }
    """
    return frame.evaluate(js_click if action == "click" else js_value)


async def set_yesterday_date(page, yesterday: str) -> bool:
    print(f"4. 设置日期为: {yesterday}")
    # 关闭可能残留的搜索弹窗
    for text in ["Close(C)", "关闭(C)"]:
        try:
            btn = page.locator(f"input[value='{text}']").first
            if await btn.is_visible(timeout=1000):
                await btn.click()
                await page.wait_for_timeout(1000)
                break
        except Exception:
            continue

    frame = None
    for f in page.frames:
        if "URLLinkIFrameIdx1" in f.name:
            frame = f
            break
    if not frame:
        for f in page.frames:
            if f != page.main_frame:
                frame = f
                break
    if not frame:
        print("   未找到 iframe")
        return False

    cur = await _locate_date_input(frame, "value")
    if cur is None:
        print("   未找到日期输入框")
        return False
    print(f"   当前日期值: {cur}")

    clicked = await _locate_date_input(frame, "click")
    if not clicked:
        print("   无法点击日期输入框")
        return False
    await page.wait_for_timeout(800)

    await page.keyboard.press("Control+a")
    await page.wait_for_timeout(200)
    for ch in yesterday:
        await page.keyboard.type(ch, delay=80)
    await page.wait_for_timeout(500)
    await page.keyboard.press("Enter")
    await page.wait_for_timeout(2000)

    new_val = await _locate_date_input(frame, "value")
    print(f"   设置后日期: {new_val}")
    await page.screenshot(path=os.path.join(DOWNLOAD_DIR, "date_set.png"))
    if new_val == yesterday:
        print(f"   ✓ 日期已设为 {yesterday}")
        return True
    print("   ⚠ 日期可能未生效")
    return False


async def export_excel(page):
    print("5. 导出 Excel...")
    frame = None
    for f in page.frames:
        if "URLLinkIFrameIdx1" in f.name:
            frame = f
            break
    if not frame:
        frame = page

    btn = await frame.query_selector(".__BaseQueryExportGroup_btnexport")
    if not btn:
        btn = await frame.query_selector(".__BaseQueryToolbar_export")
    if not btn:
        print("   未找到导出按钮")
        return None

    await btn.click()
    await page.wait_for_timeout(2000)

    menu = None
    for scope in [frame, page]:
        try:
            m = await scope.evaluate(
                "() => Array.from(document.querySelectorAll('.export-group__item'))"
                ".map(i => i.innerText.trim())"
            )
            if m:
                menu = m
                break
        except Exception:
            continue
    print(f"   导出选项: {menu}")
    if not menu:
        return None

    excel_idx = 0
    for i, t in enumerate(menu):
        if "EXCEL" in t.upper():
            excel_idx = i
            break

    try:
        async with page.expect_download(timeout=60000) as dl_info:
            await frame.evaluate(
                f"""() => {{
                    const items = document.querySelectorAll('.export-group__item');
                    if (items[{excel_idx}]) items[{excel_idx}].click();
                }}"""
            )
        dl = await dl_info.value
        path = os.path.join(DOWNLOAD_DIR, dl.suggested_filename)
        await dl.save_as(path)
        print(f"   下载完成: {path}")
        return path
    except Exception as e:
        print(f"   下载失败: {e}")
        files = glob.glob(os.path.join(DOWNLOAD_DIR, "*.xlsx"))
        if files:
            return max(files, key=os.path.getmtime)
        return None


def upload_to_dashboard(xlsx_path: str, date_str: str) -> dict:
    """multipart/form-data 上传 xlsx 到看板。传 date=昨天 → 日度整日替换（幂等）。"""
    if not UPLOAD_BASE or not INGEST_TOKEN:
        raise RuntimeError("未配置 DASHBOARD_ORDERS_UPLOAD_URL / DASHBOARD_INGEST_TOKEN")

    boundary = "----smartbi" + uuid.uuid4().hex
    filename = os.path.basename(xlsx_path)
    with open(xlsx_path, "rb") as f:
        file_bytes = f.read()

    ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="date"\r\n\r\n{date_str}\r\n'
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {ctype}\r\n\r\n"
    ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

    req = urllib.request.Request(
        UPLOAD_BASE + "/api/orders/upload",
        data=body,
        method="POST",
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "X-Upload-Token": INGEST_TOKEN,
        },
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        try:
            return json.loads(raw)
        except Exception:
            return {"raw": raw[:500]}


async def main() -> int:
    missing = [
        n for n, v in [
            ("SMARTBI_USERNAME", USERNAME),
            ("SMARTBI_PASSWORD", PASSWORD),
            ("DASHBOARD_ORDERS_UPLOAD_URL", UPLOAD_BASE),
            ("DASHBOARD_INGEST_TOKEN", INGEST_TOKEN),
        ] if not v
    ]
    if missing:
        msg = f"缺少环境变量: {', '.join(missing)}"
        print(msg, file=sys.stderr)
        alert(f"SmartBI 订单导出未启动：{msg}")
        return 1

    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    yesterday = yesterday_str()
    print(f"=== SmartBI 完成订单导出 {datetime.now()} | 目标日期 {yesterday} ===")

    async with async_playwright() as p:
        chrome_path = "/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome"
        launch_kwargs = {"headless": HEADLESS}
        if os.path.exists(chrome_path):
            launch_kwargs["executable_path"] = chrome_path
        browser = await p.chromium.launch(**launch_kwargs)
        ctx = await browser.new_context(
            ignore_https_errors=True,
            accept_downloads=True,
            viewport={"width": 1920, "height": 1080},
        )
        page = await ctx.new_page()
        xlsx_path = None
        try:
            if not await login(page):
                alert("SmartBI 登录失败，请检查账号密码/验证码")
                return 1
            if not await navigate_to_report(page):
                alert("SmartBI 未找到报表「门店每日完成订单统计」")
                return 1
            if not await set_yesterday_date(page, yesterday):
                alert(f"SmartBI 日期设置异常（目标 {yesterday}），请查看 date_set.png")
                return 1
            xlsx_path = await export_excel(page)
            if not xlsx_path:
                alert("SmartBI Excel 导出失败")
                return 2

            print("6. 回传看板...")
            try:
                result = upload_to_dashboard(xlsx_path, yesterday)
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", errors="replace")[:300]
                alert(f"SmartBI 回传看板失败 HTTP {e.code}: {detail}")
                return 3
            except Exception as e:  # noqa: BLE001
                alert(f"SmartBI 回传看板失败: {e}")
                return 3

            print(f"   看板响应: {json.dumps(result, ensure_ascii=False)[:500]}")
            if not result.get("success"):
                alert(f"SmartBI 看板导入未成功: {result.get('error') or result}")
                return 3
            print(
                f"\n✓ 完成 {yesterday}：{result.get('lines')} 行 / "
                f"{result.get('uniqueOrders')} 单，写入 {result.get('inserted')} 条"
                + (f"（替换旧 {result.get('deleted')} 条）" if result.get("deleted") else "")
            )
            return 0
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            try:
                await page.screenshot(path=os.path.join(DOWNLOAD_DIR, "error.png"))
            except Exception:
                pass
            alert(f"SmartBI 订单导出异常: {e}")
            return 1
        finally:
            await browser.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
