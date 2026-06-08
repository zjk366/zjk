{
  "targets": [
    {
      "target_name": "window_capture",
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "sources": [ "window_capture.cpp" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "libraries": [
        "-lgdi32",
        "-luser32",
        "-lole32",
        "-lwindowscodecs"
      ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 2,
          "AdditionalOptions": [ "/source-charset:utf-8", "/execution-charset:utf-8" ]
        }
      }
    }
  ]
}
