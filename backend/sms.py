"""阿里云短信验证码：双通道（PNS 主用 / SMS 备用）+ RPC V1 手写签名。

与参考实现完全同构：
- 主用 api_type="pns"：https://dypnsapi.aliyuncs.com/ Action=SendSmsVerifyCode，手机号字段 PhoneNumber
- 备用 api_type="sms"：https://dysmsapi.aliyuncs.com/ Action=SendSms，手机号字段 PhoneNumbers
- 签名：RFC3986 percent-encode + key 字典序 + GET&%2F&<再编码> + HMAC-SHA1(SK+"&") + base64
- 不装阿里云 SDK，仅用 httpx（trust_env=False 绕开代理环境变量）
- 配置读取根目录 config.json 的 sms 段；四项必填任一为空直接报错，绝不降级
- 验证码明文只落服务端数据库，不返回前端、不打日志
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
import urllib.parse
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config.json"

CODE_TTL_SECONDS = 5 * 60          # 验证码 5 分钟有效（模板变量 min=5 与此对应）
RESEND_COOLDOWN_SECONDS = 60       # 同号 60 秒重发冷却
DAILY_LIMIT = 10                    # 同号每 24 小时上限 10 条
PHONE_PATTERN = re.compile(r"^1[3-9]\d{9}$")  # 大陆 11 位手机号

CHANNELS = {
    # api_type: (endpoint, Action, 手机号字段名)
    "pns": ("https://dypnsapi.aliyuncs.com/", "SendSmsVerifyCode", "PhoneNumber"),
    "sms": ("https://dysmsapi.aliyuncs.com/", "SendSms", "PhoneNumbers"),
}


class SmsError(Exception):
    """发送失败：message 可直接透出给接口调用方"""


def load_sms_config() -> dict[str, str]:
    try:
        raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        sms = raw.get("sms", {})
    except (OSError, json.JSONDecodeError) as error:
        raise SmsError(f"短信配置不可用：请检查 {CONFIG_PATH}（{error}）") from error
    config = {
        "access_key_id": str(sms.get("access_key_id") or "").strip(),
        "access_key_secret": str(sms.get("access_key_secret") or "").strip(),
        "sign_name": str(sms.get("sign_name") or "").strip(),
        "template_code": str(sms.get("template_code") or "").strip(),
        "template_param": str(sms.get("template_param") or '{"code":"${code}","min":"5"}'),
        "api_type": str(sms.get("api_type") or "pns"),
    }
    missing = [
        name for name in
        ("access_key_id", "access_key_secret", "sign_name", "template_code")
        if not config[name]
    ]
    if missing:
        raise SmsError(
            f"短信配置不完整（{', '.join(missing)} 为空）：请在 {CONFIG_PATH} 的 sms 段填写后重启服务"
        )
    if config["api_type"] not in CHANNELS:
        raise SmsError(f"短信 api_type 仅支持 pns/sms，当前为 {config['api_type']}")
    return config


def generate_code() -> str:
    """6 位数字验证码，密码学随机源，前导补零"""
    return f"{secrets.randbelow(1000000):06d}"


def percent_encode(value: str) -> str:
    """RFC3986 percent-encode：仅 -_.~ 为安全字符（空格→%20，中文/冒号/花括号等全编码）"""
    return urllib.parse.quote(str(value), safe="-_.~")


def build_signature(params: dict[str, str], access_key_secret: str) -> str:
    """阿里云 RPC V1 签名：排序拼接 → GET&%2F&<整体再编码> → HMAC-SHA1(SK+"&") → base64"""
    sorted_query = "&".join(
        f"{percent_encode(key)}={percent_encode(params[key])}" for key in sorted(params)
    )
    string_to_sign = f"GET&{percent_encode('/')}&{percent_encode(sorted_query)}"
    digest = hmac.new(
        (access_key_secret + "&").encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode("utf-8")


def send_verification_code(phone: str, code: str) -> None:
    """调用阿里云发送验证码；失败抛 SmsError（携带 Code 与 Message）。"""
    config = load_sms_config()
    endpoint, action, phone_field = CHANNELS[config["api_type"]]
    template_param = config["template_param"].replace("${code}", code)
    params: dict[str, str] = {
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": str(uuid.uuid4()),
        "AccessKeyId": config["access_key_id"],
        "SignatureVersion": "1.0",
        "Timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Format": "JSON",
        "Version": "2017-05-25",
        "Action": action,
        "RegionId": "cn-hangzhou",
        phone_field: phone,
        "SignName": config["sign_name"],
        "TemplateCode": config["template_code"],
        "TemplateParam": template_param,
    }
    params["Signature"] = build_signature(
        {k: v for k, v in params.items() if k != "Signature"},
        config["access_key_secret"],
    )
    try:
        response = httpx.get(
            endpoint,
            params=params,
            timeout=10,
            trust_env=False,  # 显式绕开机器上的代理环境变量
        )
        payload: dict[str, Any] = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise SmsError(f"短信服务请求失败：{error}") from error
    if payload.get("Code") != "OK":
        raise SmsError(f"短信服务返回错误 {payload.get('Code')}：{payload.get('Message')}")
