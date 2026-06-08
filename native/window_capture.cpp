/**
 * window_capture.cpp — Native PrintWindow 截图模块
 *
 * 导出两个函数：
 *   listWindows() → JSON 字符串（窗口列表）
 *   captureWindow(hwnd) → Buffer（PNG 字节）
 *
 * 使用 N-API (node-addon-api) 构建。
 */
#define NOMINMAX
#include <napi.h>
#include <windows.h>
#include <dwmapi.h>
#include <wincodec.h>
#include <vector>
#include <string>
#include <sstream>
#include <algorithm>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "dwmapi.lib")

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
        // 提取文件名
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
    RECT rect;
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
    // 最小化窗口跳过
    if (IsIconic(hwnd)) return TRUE;

    // H: 获取 PID 并排除自身
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
        if (actualLen > 1) title.resize(actualLen - 1); // 去掉 null 终止符
    }
    if (title.empty()) return TRUE;

    // C: 样式检查 — 必须有 WS_CAPTION（真实窗口才有标题栏）
    LONG style = GetWindowLong(hwnd, GWL_STYLE);
    if (!(style & WS_CAPTION)) return TRUE;

    // D: 扩展样式过滤
    LONG exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
    if (exStyle & WS_EX_TOOLWINDOW) return TRUE;        // 工具条窗口
    if (exStyle & WS_EX_TRANSPARENT) return TRUE;       // 透明穿透窗口
    if ((exStyle & WS_EX_NOACTIVATE) && (exStyle & WS_EX_LAYERED)) return TRUE; // 无激活+透明

    // E: DWM Cloak 检查（UWP 后台/虚拟桌面隐藏窗口）
    DWORD cloak = 0;
    if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloak, sizeof(cloak)))) {
        if (cloak != 0) return TRUE;
    }

    // F: 尺寸检查
    RECT rect;
    if (!GetWindowRect(hwnd, &rect)) return TRUE;
    int w = rect.right - rect.left;
    int h = rect.bottom - rect.top;
    if (w < 100 || h < 100 || w > 4000 || h > 3000) return TRUE;

    // G: 进程名黑名单
    if (IsBlacklistedProcess(pid)) return TRUE;

    p->list->push_back({ hwnd, title, rect, pid });
    return TRUE;
}

// ─── PrintWindow 截图 ──────────────────────────────

static bool CaptureWindowToPng(HWND hwnd, int width, int height, std::vector<unsigned char>& outPng) {
    HDC hdcWindow = GetDC(hwnd);
    if (!hdcWindow) return false;

    HDC hdcMem = CreateCompatibleDC(hdcWindow);
    if (!hdcMem) { ReleaseDC(hwnd, hdcWindow); return false; }

    HBITMAP hBitmap = CreateCompatibleBitmap(hdcWindow, width, height);
    if (!hBitmap) { DeleteDC(hdcMem); ReleaseDC(hwnd, hdcWindow); return false; }

    SelectObject(hdcMem, hBitmap);
    // PW_RENDERFULLCONTENT = 2: 强制渲染完整窗口内容（含 DWM 合成内容）
    BOOL ok = PrintWindow(hwnd, hdcMem, 2);
    if (!ok) { DeleteObject(hBitmap); DeleteDC(hdcMem); ReleaseDC(hwnd, hdcWindow); return false; }

    // 获取 BITMAP 信息
    BITMAP bmp = { 0 };
    GetObject(hBitmap, sizeof(BITMAP), &bmp);

    // 读取像素
    int stride = ((bmp.bmWidth * 32 + 31) / 32) * 4;
    std::vector<unsigned char> raw(stride * bmp.bmHeight);
    GetBitmapBits(hBitmap, (LONG)raw.size(), raw.data());

    // 转换 BGRA → RGBA（无翻转，PrintWindow 已返回正序）
    int totalPixels = bmp.bmWidth * bmp.bmHeight;
    std::vector<unsigned char> rgba(totalPixels * 4);
    bool hasContent = false;
    for (int y = 0; y < bmp.bmHeight; y++) {
        const unsigned char* src = raw.data() + y * stride;
        unsigned char* dst = rgba.data() + y * bmp.bmWidth * 4;
        for (int x = 0; x < bmp.bmWidth; x++) {
            int si = x * 4;
            int di = x * 4;
            dst[di + 0] = src[si + 2];  // R
            dst[di + 1] = src[si + 1];  // G
            dst[di + 2] = src[si + 0];  // B
            dst[di + 3] = 255;           // A
        }
        // 采样检查：每行第 5 个像素，有非零 RGB 即标记有内容
        if (!hasContent && y % 20 == 0) {
            for (int x = 0; x < bmp.bmWidth; x += 20) {
                int si = x * 4;
                if (raw[si + 2] || raw[si + 1] || raw[si + 0]) { hasContent = true; break; }
            }
        }
    }

    DeleteObject(hBitmap);
    DeleteDC(hdcMem);
    ReleaseDC(hwnd, hdcWindow);

    // 全黑/透明窗口判定
    if (!hasContent) return false;

    // 使用 WIC (Windows Imaging Component) 编码为 PNG
    bool saved = false;
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (SUCCEEDED(hr)) {
        IWICImagingFactory* wicFactory = nullptr;
        hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
            IID_IWICImagingFactory, (LPVOID*)&wicFactory);
        if (SUCCEEDED(hr) && wicFactory) {
            IWICBitmap* wicBitmap = nullptr;
            hr = wicFactory->CreateBitmapFromMemory(bmp.bmWidth, bmp.bmHeight,
                GUID_WICPixelFormat32bppBGRA,
                bmp.bmWidth * 4, rgba.size(), rgba.data(), &wicBitmap);
            if (SUCCEEDED(hr) && wicBitmap) {
                IWICStream* wicStream = nullptr;
                hr = wicFactory->CreateStream(&wicStream);
                if (SUCCEEDED(hr) && wicStream) {
                    IStream* pStream = nullptr;
                    if (CreateStreamOnHGlobal(nullptr, TRUE, &pStream) == S_OK) {
                        hr = wicStream->InitializeFromIStream(pStream);
                        if (SUCCEEDED(hr)) {
                            IWICBitmapEncoder* encoder = nullptr;
                            hr = wicFactory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder);
                            if (SUCCEEDED(hr) && encoder) {
                                hr = encoder->Initialize(wicStream, WICBitmapEncoderNoCache);
                                if (SUCCEEDED(hr)) {
                                    IWICBitmapFrameEncode* frame = nullptr;
                                    IPropertyBag2* props = nullptr;
                                    hr = encoder->CreateNewFrame(&frame, &props);
                                    if (SUCCEEDED(hr)) {
                                        frame->Initialize(props);
                                        frame->SetSize(bmp.bmWidth, bmp.bmHeight);
                                        WICPixelFormatGUID fmt = GUID_WICPixelFormat32bppBGRA;
                                        frame->SetPixelFormat(&fmt);
                                        frame->WriteSource(wicBitmap, nullptr);
                                        frame->Commit();
                                        encoder->Commit();

                                        HGLOBAL hG = nullptr;
                                        GetHGlobalFromStream(pStream, &hG);
                                        if (hG) {
                                            LPVOID ptr = GlobalLock(hG);
                                            if (ptr) {
                                                SIZE_T len = GlobalSize(hG);
                                                if (len > 0) {
                                                    outPng.resize(len);
                                                    memcpy(outPng.data(), ptr, len);
                                                    saved = true;
                                                }
                                                GlobalUnlock(hG);
                                            }
                                        }
                                        frame->Release();
                                        props->Release();
                                    }
                                }
                                encoder->Release();
                            }
                        }
                        pStream->Release();
                    }
                    wicStream->Release();
                }
                wicBitmap->Release();
            }
            wicFactory->Release();
        }
        CoUninitialize();
    }
    return saved;
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
    DWORD myPid = excludePid;
    EnumWindows(EnumWindowProc, reinterpret_cast<LPARAM>(&ep));

    Napi::Array result = Napi::Array::New(env, windows.size());
    for (size_t i = 0; i < windows.size(); i++) {
        Napi::Object obj = Napi::Object::New(env);
        char hwndStr[32];
        snprintf(hwndStr, sizeof(hwndStr), "%llu", (unsigned long long)windows[i].hwnd);
        obj.Set("hwnd", hwndStr);
        obj.Set("title", windows[i].title);
        obj.Set("titleLen", (uint32_t)windows[i].title.length());
        obj.Set("pid", (uint32_t)windows[i].pid);
        obj.Set("left", windows[i].rect.left);
        obj.Set("top", windows[i].rect.top);
        obj.Set("right", windows[i].rect.right);
        obj.Set("bottom", windows[i].rect.bottom);
        obj.Set("width", windows[i].rect.right - windows[i].rect.left);
        obj.Set("height", windows[i].rect.bottom - windows[i].rect.top);
        result[i] = obj;
    }
    return result;
}

Napi::Value CaptureWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 5) {
        Napi::TypeError::New(env, "Expected 5 arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    // hwnd: string or number
    std::string hwndStr = info[0].ToString().Utf8Value();
    ULONGLONG hwndVal = std::stoull(hwndStr);
    HWND hwnd = reinterpret_cast<HWND>(hwndVal);

    int width = info[1].ToNumber().Int32Value();
    int height = info[2].ToNumber().Int32Value();
    int maxWidth = info[3].ToNumber().Int32Value();
    int maxHeight = info[4].ToNumber().Int32Value();

    // 缩放比例（限制最大分辨率）
    double _sc = 1.0;
    if (width > maxWidth) _sc = (double)maxWidth / (double)width;
    if (height > maxHeight) _sc = (double)maxHeight / (double)height;

    int capW = (int)((double)width * _sc);
    int capH = (int)((double)height * _sc);

    std::vector<unsigned char> pngData;
    if (!CaptureWindowToPng(hwnd, capW, capH, pngData)) {
        Napi::Error::New(env, "BLANK_FRAME").ThrowAsJavaScriptException();
        return env.Null();
    }

    return Napi::Buffer<unsigned char>::Copy(env, pngData.data(), pngData.size());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("listWindows", Napi::Function::New(env, ListWindows));
    exports.Set("captureWindow", Napi::Function::New(env, CaptureWindow));
    return exports;
}

NODE_API_MODULE(window_capture, Init)
