/**
 * window_capture.cpp — Native PrintWindow 截图模块 v2
 *
 * 核心变更：
 *   1. PW_RENDERFULLCONTENT (0x00000002) 强制获取完整 DWM 合成内容
 *   2. DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS) 替代 GetWindowRect
 *   3. 输出客户区偏移量 + 尺寸，供前端精确裁切
 *   4. 原生层不做缩放，保留 BGRA 输出
 *   5. isValidFrame 校验返回 validity 标志
 *
 * 导出函数：
 *   listWindows(pid) → WindowInfo[]
 *   captureWindow(hwndStr) → { rawBuffer, width, height, contentOffsetX,
 *                              contentOffsetY, contentWidth, contentHeight, isValid, timestamp }
 *
 * 使用 N-API (node-addon-api) 构建。
 */
#define NOMINMAX
#include <napi.h>
#include <windows.h>
#include <dwmapi.h>
#include <vector>
#include <string>
#include <algorithm>

#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")

// ─── 进程名黑名单（部分匹配） ─────────────────────────
static const char* PROCESS_BLACKLIST[] = {
    "TextInputHost.exe",
    "ShellExperienceHost.exe",
    "SearchHost.exe",
    "StartMenuExperienceHost.exe",
    "ntvdm.exe",
    "nvOverlay",
    "RTSS",
    "GameBar",
    "ApplicationFrameHost.exe",
    "backgroundTaskHost.exe",
    "RuntimeBroker.exe",
    "sihost.exe",
    "taskhostw.exe",
    nullptr
};

static bool IsBlacklistedProcess(DWORD pid) {
    HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!hProc) return false;
    char path[MAX_PATH] = { 0 };
    DWORD size = MAX_PATH;
    bool blacklisted = false;
    if (QueryFullProcessImageNameA(hProc, 0, path, &size)) {
        char* fname = path;
        for (char* p = path; *p; p++) if (*p == '\\') fname = p + 1;
        for (int i = 0; PROCESS_BLACKLIST[i]; i++) {
            if (strstr(fname, PROCESS_BLACKLIST[i]) != nullptr) {
                blacklisted = true;
                break;
            }
        }
    }
    CloseHandle(hProc);
    return blacklisted;
}

// ─── 窗口枚举 ──────────────────────────────────────

struct WindowInfo {
    HWND hwnd;
    std::string title;
    RECT extBounds;   // DWMWA_EXTENDED_FRAME_BOUNDS（或 GetWindowRect 兜底）
    DWORD pid;
};

struct EnumParam {
    std::vector<WindowInfo>* list;
    DWORD excludePid;
};

static BOOL CALLBACK EnumWindowProc(HWND hwnd, LPARAM lParam) {
    auto* p = reinterpret_cast<EnumParam*>(lParam);

    // A: 可见性检查
    if (!IsWindowVisible(hwnd)) return TRUE;
    if (IsIconic(hwnd)) return TRUE;

    // H: 获取 PID 并排除自身主进程
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (p->excludePid > 0 && pid == p->excludePid) return TRUE;

    // B: 标题检查
    int len = GetWindowTextLengthW(hwnd);
    if (len < 2) return TRUE;
    std::wstring wstr(len + 1, L'\0');
    GetWindowTextW(hwnd, &wstr[0], len + 1);
    int mbLen = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string title;
    if (mbLen > 1) {
        title.resize(mbLen);
        int actualLen = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, &title[0], mbLen, nullptr, nullptr);
        if (actualLen > 1) title.resize(actualLen - 1);
    }
    if (title.empty()) return TRUE;

    // C: 样式检查 — 必须有 WS_CAPTION
    LONG style = GetWindowLong(hwnd, GWL_STYLE);
    if (!(style & WS_CAPTION)) return TRUE;

    // D: 扩展样式过滤
    LONG exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
    if (exStyle & WS_EX_TOOLWINDOW) return TRUE;
    if (exStyle & WS_EX_TRANSPARENT) return TRUE;
    if ((exStyle & WS_EX_NOACTIVATE) && (exStyle & WS_EX_LAYERED)) return TRUE;

    // E: DWM Cloak 检查
    DWORD cloak = 0;
    if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloak, sizeof(cloak)))) {
        if (cloak != 0) return TRUE;
    }

    // F: 尺寸检查 — 使用 DWMWA_EXTENDED_FRAME_BOUNDS 替代 GetWindowRect
    RECT bounds;
    HRESULT hr = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds));
    if (FAILED(hr)) {
        // 降级：GetWindowRect
        if (!GetWindowRect(hwnd, &bounds)) return TRUE;
    }
    int w = bounds.right - bounds.left;
    int h = bounds.bottom - bounds.top;
    if (w < 100 || h < 100 || w > 4000 || h > 3000) return TRUE;

    // G: 进程名黑名单
    if (IsBlacklistedProcess(pid)) return TRUE;

    p->list->push_back({ hwnd, title, bounds, pid });
    return TRUE;
}

// ─── 截图：直接获取 BGRA 像素（无 WIC 编码） ─────────
//
// 返回结构体：
//   rawBuffer      — BGRA 像素 Buffer
//   width/height   — 捕获尺寸
//   contentOffsetX/Y — 客户区相对 EXTENDED_FRAME_BOUNDS 的偏移
//   contentWidth/Height — 客户区尺寸
//   isValid        — 像素有效性（false = 全黑/全透明帧）
//
// PrintWindow 使用 PW_RENDERFULLCONTENT (0x00000002) 标志，
// 确保获取完整的 DWM 合成内容。

struct CaptureResult {
    std::vector<unsigned char> rawBuffer;  // BGRA pixels
    int width;
    int height;
    int contentOffsetX;
    int contentOffsetY;
    int contentWidth;
    int contentHeight;
    bool isValid;
};

static bool GetClientContentOffset(HWND hwnd, const RECT& extBounds, int& outX, int& outY, int& outW, int& outH) {
    RECT clientRect;
    if (!GetClientRect(hwnd, &clientRect)) {
        outX = 0; outY = 0; outW = 0; outH = 0;
        return false;
    }
    POINT clientOrigin = { clientRect.left, clientRect.top };
    if (!ClientToScreen(hwnd, &clientOrigin)) {
        outX = 0; outY = 0; outW = 0; outH = 0;
        return false;
    }
    // 客户区边界相对于 EXTENDED_FRAME_BOUNDS 的偏移
    outX = clientOrigin.x - extBounds.left;
    outY = clientOrigin.y - extBounds.top;
    outW = clientRect.right - clientRect.left;
    outH = clientRect.bottom - clientRect.top;
    return true;
}

// 检查 BGRA buffer 是否有效（非全黑/全透明）
static bool CheckIsValid(const unsigned char* pixels, int pixelCount) {
    if (!pixels || pixelCount <= 0) return false;
    // 采样步长：至少检查 200 个像素
    int step = std::max(1, pixelCount / 200);
    for (int i = 0; i < pixelCount * 4; i += step * 4) {
        // BGRA: B=0, G=1, R=2, A=3
        if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) return true;
    }
    return false;
}

static CaptureResult CaptureWindowRaw(HWND hwnd) {
    CaptureResult result = {};

    // ── 1. 获取窗口真实边界（DWMWA_EXTENDED_FRAME_BOUNDS） ──
    RECT extBounds;
    HRESULT hr = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &extBounds, sizeof(extBounds));
    if (FAILED(hr)) {
        // 降级到 GetWindowRect
        if (!GetWindowRect(hwnd, &extBounds)) return result;
    }
    int capW = extBounds.right - extBounds.left;
    int capH = extBounds.bottom - extBounds.top;
    if (capW < 10 || capH < 10) return result;

    // ── 2. 获取客户区偏移 ─────────────────────────────
    GetClientContentOffset(hwnd, extBounds,
        result.contentOffsetX, result.contentOffsetY,
        result.contentWidth, result.contentHeight);

    // ── 3. PrintWindow 捕获（PW_RENDERFULLCONTENT = 0x00000002） ──
    HDC hdcWindow = GetDC(hwnd);
    if (!hdcWindow) return result;

    HDC hdcMem = CreateCompatibleDC(hdcWindow);
    if (!hdcMem) { ReleaseDC(hwnd, hdcWindow); return result; }

    HBITMAP hBitmap = CreateCompatibleBitmap(hdcWindow, capW, capH);
    if (!hBitmap) { DeleteDC(hdcMem); ReleaseDC(hwnd, hdcWindow); return result; }

    HGDIOBJ oldBmp = SelectObject(hdcMem, hBitmap);

    // ★ PW_RENDERFULLCONTENT = 2: 强制渲染完整窗口内容（含 DWM 合成内容）
    //    Win8.1+ 全版本支持，无降级必要
    BOOL pwOk = PrintWindow(hwnd, hdcMem, 2);  // PW_RENDERFULLCONTENT
    if (!pwOk) {
        SelectObject(hdcMem, oldBmp);
        DeleteObject(hBitmap); DeleteDC(hdcMem); ReleaseDC(hwnd, hdcWindow);
        return result;
    }

    // ── 4. 分辨率上限：超大窗口 StretchBlt 缩放到 MAX 1920×1080 ──
    //    之后 IPC 传输 + Canvas 处理的数据量恒定，大窗口不卡顿。
    const int MAX_CAP_W = 1920, MAX_CAP_H = 1080;
    BITMAP bmp = { 0 };
    GetObject(hBitmap, sizeof(BITMAP), &bmp);
    int srcW = bmp.bmWidth;
    int srcH = bmp.bmHeight;

    double scale = 1.0;
    HBITMAP hScaledBmp = nullptr;
    HDC hdcScale = nullptr;

    if (srcW > MAX_CAP_W || srcH > MAX_CAP_H) {
        scale = std::min((double)MAX_CAP_W / srcW, (double)MAX_CAP_H / srcH);
        int outW = (int)(srcW * scale);
        int outH = (int)(srcH * scale);

        hdcScale = CreateCompatibleDC(hdcWindow);
        if (hdcScale) {
            hScaledBmp = CreateCompatibleBitmap(hdcWindow, outW, outH);
            if (hScaledBmp) {
                SelectObject(hdcScale, hScaledBmp);
                // HALFTONE = 高质量缩放
                SetStretchBltMode(hdcScale, HALFTONE);
                StretchBlt(hdcScale, 0, 0, outW, outH, hdcMem, 0, 0, srcW, srcH, SRCCOPY);

                // 缩放 contentOffset 成比例
                result.contentOffsetX = (int)(result.contentOffsetX * scale);
                result.contentOffsetY = (int)(result.contentOffsetY * scale);
                result.contentWidth = (int)(result.contentWidth * scale);
                result.contentHeight = (int)(result.contentHeight * scale);
            } else {
                DeleteDC(hdcScale); hdcScale = nullptr;
            }
        }
    }

    // ── 5. 从最终 Bitmap 读取 BGRA 像素 ────────────────
    HBITMAP hFinalBmp = hScaledBmp ? hScaledBmp : hBitmap;
    BITMAP finalBmp = { 0 };
    GetObject(hFinalBmp, sizeof(BITMAP), &finalBmp);

    int finalStride = ((finalBmp.bmWidth * 32 + 31) / 32) * 4;
    int finalBytes = finalStride * finalBmp.bmHeight;
    int finalPixels = finalBmp.bmWidth * finalBmp.bmHeight;

    std::vector<unsigned char> raw(finalBytes);
    GetBitmapBits(hFinalBmp, (LONG)raw.size(), raw.data());

    // 复制为连续 BGRA
    result.rawBuffer.resize(finalPixels * 4);
    if (finalStride == finalBmp.bmWidth * 4) {
        result.rawBuffer = std::move(raw);
    } else {
        for (int y = 0; y < finalBmp.bmHeight; y++) {
            memcpy(result.rawBuffer.data() + y * finalBmp.bmWidth * 4,
                   raw.data() + y * finalStride,
                   finalBmp.bmWidth * 4);
        }
    }
    result.width = finalBmp.bmWidth;
    result.height = finalBmp.bmHeight;
    result.isValid = CheckIsValid(result.rawBuffer.data(), finalPixels);

    // ── 6. 清理 GDI 资源 ──────────────────────────────
    if (hScaledBmp) { SelectObject(hdcScale, hScaledBmp); DeleteObject(hScaledBmp); }
    if (hdcScale) DeleteDC(hdcScale);
    SelectObject(hdcMem, oldBmp);
    DeleteObject(hBitmap);
    DeleteDC(hdcMem);
    ReleaseDC(hwnd, hdcWindow);

    return result;
}

// ─── N-API 导出函数 ────────────────────────────────

Napi::Value ListWindows(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    DWORD excludePid = 0;
    if (info.Length() > 0 && info[0].IsNumber()) {
        excludePid = (DWORD)info[0].ToNumber().Uint32Value();
    }

    std::vector<WindowInfo> windows;
    EnumParam ep = { &windows, excludePid };
    EnumWindows(EnumWindowProc, reinterpret_cast<LPARAM>(&ep));

    Napi::Array result = Napi::Array::New(env, windows.size());
    for (size_t i = 0; i < windows.size(); i++) {
        Napi::Object obj = Napi::Object::New(env);
        char hwndStr[32];
        snprintf(hwndStr, sizeof(hwndStr), "%llu", (unsigned long long)windows[i].hwnd);
        obj.Set("hwnd", hwndStr);
        obj.Set("title", windows[i].title);
        obj.Set("pid", (uint32_t)windows[i].pid);
        // DWMWA_EXTENDED_FRAME_BOUNDS 边界
        obj.Set("left", windows[i].extBounds.left);
        obj.Set("top", windows[i].extBounds.top);
        obj.Set("right", windows[i].extBounds.right);
        obj.Set("bottom", windows[i].extBounds.bottom);
        obj.Set("width", windows[i].extBounds.right - windows[i].extBounds.left);
        obj.Set("height", windows[i].extBounds.bottom - windows[i].extBounds.top);
        result[i] = obj;
    }
    return result;
}

Napi::Value CaptureWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Expected at least 1 argument (hwndStr)").ThrowAsJavaScriptException();
        return env.Null();
    }

    // hwnd: 十进制字符串
    std::string hwndStr = info[0].ToString().Utf8Value();
    ULONGLONG hwndVal = std::stoull(hwndStr);
    HWND hwnd = reinterpret_cast<HWND>(hwndVal);

    // 检查窗口是否有效
    if (!IsWindow(hwnd)) {
        Napi::Error::New(env, "INVALID_WINDOW").ThrowAsJavaScriptException();
        return env.Null();
    }

    CaptureResult cr = CaptureWindowRaw(hwnd);
    if (cr.rawBuffer.empty() || cr.width <= 0 || cr.height <= 0) {
        Napi::Error::New(env, "CAPTURE_FAILED").ThrowAsJavaScriptException();
        return env.Null();
    }

    // 构造返回对象
    Napi::Object ret = Napi::Object::New(env);

    // BGRA 像素 Buffer
    ret.Set("rawBuffer", Napi::Buffer<unsigned char>::Copy(env, cr.rawBuffer.data(), cr.rawBuffer.size()));
    ret.Set("width", cr.width);
    ret.Set("height", cr.height);

    // 客户区偏移（前端裁切用）
    ret.Set("contentOffsetX", cr.contentOffsetX);
    ret.Set("contentOffsetY", cr.contentOffsetY);
    ret.Set("contentWidth", cr.contentWidth);
    ret.Set("contentHeight", cr.contentHeight);

    // 有效性标志
    ret.Set("isValid", cr.isValid);
    ret.Set("timestamp", (uint64_t)GetTickCount64());

    return ret;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("listWindows", Napi::Function::New(env, ListWindows));
    exports.Set("captureWindow", Napi::Function::New(env, CaptureWindow));
    return exports;
}

NODE_API_MODULE(window_capture, Init)
