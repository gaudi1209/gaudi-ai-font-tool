# -*- coding: utf-8 -*-
"""AI字体生产工具 - 配置文件"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 安装根目录（app/ 的上一级，适配一键安装包结构）
INSTALL_ROOT = os.path.dirname(BASE_DIR)

# 加载 .env 文件（安装脚本自动生成，不覆盖已有环境变量）
_dotenv = os.path.join(INSTALL_ROOT, '.env')
if os.path.isfile(_dotenv):
    with open(_dotenv, 'r', encoding='utf-8') as _f:
        for _line in _f:
            _line = _line.strip()
            if not _line or _line.startswith('#') or '=' not in _line:
                continue
            _k, _v = _line.split('=', 1)
            _k, _v = _k.strip(), _v.strip().strip('"').strip("'")
            if _k not in os.environ:
                os.environ[_k] = _v

def _env(key, default):
    return os.environ.get(key, default)

# zi2zi-JiT 引擎目录
ZI2ZI_DIR = _env("ZI2ZI_DIR", r"D:\Claudecode\字体训练\zi2zi-JiT-main")

# Python 环境
ZI2ZI_PYTHON = _env("ZI2ZI_PYTHON", r"C:\Users\chenlin\.conda\envs\zi2zi-jit\python.exe")
OCR_PYTHON = _env("OCR_PYTHON", r"D:\Claudecode\paddle-ocr\venv\Scripts\python.exe")
SYSTEM_PYTHON = "python"

# 默认路径
DEFAULT_BASE_CHECKPOINT = os.path.join(ZI2ZI_DIR, "models", "zi2zi-JiT-B-16.pth")
DEFAULT_SOURCE_FONT = os.path.join(ZI2ZI_DIR, "data", "font", "WenJinMinchoP0-Regular.ttf")
DEFAULT_REF_FONT = _env("DEFAULT_REF_FONT", "")
DEFAULT_RUN_DIR = os.path.join(ZI2ZI_DIR, "run")

# 训练默认参数
TRAIN_DEFAULTS = {
    "model": "JiT-B/16",
    "epochs": 200,
    "batch_size": 64,
    "lora_r": 32,
    "lora_alpha": 32,
    "lora_targets": "qkv,proj,w12,w3",
    "cfg": 2.6,
    "sampling_method": "heun",
    "num_sampling_steps": 50,
    "num_fonts": 1000,
    "num_chars": 200000,
    "max_chars_per_font": 10000,
    "num_workers": 0,
}

# 生成默认参数
GENERATE_DEFAULTS = {
    "multiplier": 5,
    "max_rounds": 10,
    "confidence_threshold": 0.5,
    "cfg": 4.0,
    "sampling_method": "heun",
    "num_sampling_steps": 50,
    "batch_size": 64,
    "resolution": 256,
    "ref_size": 128,
}

# 字符集定义
CHARSET_SIZES = {
    "GB2312": 6763,
    "GBK": 20902,
    "Big5": 13053,
}

# 参考字符
REF_CHARS = ['永', '和', '之', '道', '心', '人', '大', '天']

# Flask 配置
HOST = "127.0.0.1"
PORT = 7550
DEBUG = False
