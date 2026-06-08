/**
 * window_capture.cpp — Native PrintWindow 截图模块
 *
 * 导出两个函数：
 *   listWindows() → JSON 字符串（窗口列表）
 *   captureWindow(hwnd) → Buffer（PNG 字节）
 *
 * 使用 N-API (node-addon-api) 构建。
 */
#include <napi.h>
#include <windows.h>
#include <wincodec.h>
#include <vector>
#include <string>
#include <sstream>
#include <algorithm>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "windowscodecs.lib")

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
    if (!IsWindowVisible(hwnd)) return TRUE;
    if (IsIconic(hwnd)) return TRUE;

    // 排除自身进程
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (p->excludePid > 0 && pid == p->excludePid) return TRUE;

    int len = GetWindowTextLengthW(hwnd);
    if (len < 2) return TRUE;

    std::wstring wstr(len + 1, L'\0');
    GetWindowTextW(hwnd, &wstr[0], len + 1);
    int mbLen = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string title;
    if (mbLen > 1) {
        title.resize(mbLen - 1);
        WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, &title[0], mbLen, nullptr, nullptr);
    }
    if (title.empty()) return TRUE;

    RECT rect;
    if (!GetWindowRect(hwnd, &rect)) return TRUE;
    int w = rect.right - rect.left;
    int h = rect.bottom - rect.top;
    if (w < 60 || h < 60 || w > 4000 || h > 3000) return TRUE;

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
    BOOL ok = PrintWindow(hwnd, hdcMem, 0);
    if (!ok) { DeleteObject(hBitmap); DeleteDC(hdcMem); ReleaseDC(hwnd, hdcWindow); return false; }

    // 获取 BITMAP 信息
    BITMAP bmp = { 0 };
    GetObject(hBitmap, sizeof(BITMAP), &bmp);

    // 读取像素
    int stride = ((bmp.bmWidth * 32 + 31) / 32) * 4;
    std::vector<unsigned char> raw(stride * bmp.bmHeight);
    GetBitmapBits(hBitmap, (LONG)raw.size(), raw.data());

    // 翻转并转换 BGRA → RGBA
    int totalPixels = bmp.bmWidth * bmp.bmHeight;
    std::vector<unsigned char> rgba(totalPixels * 4);
    for (int y = 0; y < bmp.bmHeight; y++) {
        const unsigned char* src = raw.data() + y * stride;
        unsigned char* dst = rgba.data() + (bmp.bmHeight - 1 - y) * bmp.bmWidth * 4;
        for (int x = 0; x < bmp.bmWidth; x++) {
            int si = x * 4;
            int di = x * 4;
            dst[di + 0] = src[si + 2];  // R
            dst[di + 1] = src[si + 1];  // G
            dst[di + 2] = src[si + 0];  // B
            dst[di + 3] = 255;           // A
        }
    }

    DeleteObject(hBitmap);
    DeleteDC(hdcMem);
    ReleaseDC(hwnd, hdcWindow);

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
