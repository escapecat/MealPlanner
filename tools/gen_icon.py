#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成主屏幕图标。

为什么要有它:「添加到主屏幕」之后,图标就是这个 app 在你手机上的样子。
没有图标的话 iOS 会拿页面截图当图标 —— 一块糊的白底灰字,认不出来是什么。

⚠️ 图标是**生成物**,不是手工二进制。
   仓库里躺着几个来路不明的 png,以后想调个颜色都不知道从哪儿改起。
   这个脚本用 zlib 直接写 PNG,不引任何库(项目零依赖是硬要求)。

用法:python tools/gen_icon.py
"""

import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, '..', 'app')

ACCENT = (0x2f, 0x6f, 0x4e)      # --accent,和 style.css 里那个绿一致
# ⚠️ 米色不能用 --bg 那个 #f5f6f8:它和碗的纯白差 3%,48px 下两块糊成一团,
#    看着像个白饼。图标是**在很小的时候被认出来**的,对比度比配色协调重要。
RICE = (0xf2, 0xe3, 0xc0)
BOWL = (0xff, 0xff, 0xff)


def png(path, size, pixels):
    """pixels: 一个 (x, y) -> (r,g,b) 的函数。写成不透明 RGB PNG。"""
    raw = bytearray()
    for y in range(size):
        raw.append(0)                       # 每行的 filter type:0 = None
        for x in range(size):
            raw.extend(pixels(x, y))

    def chunk(tag, data):
        out = struct.pack('>I', len(data)) + tag + data
        return out + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)   # 8bit, truecolor
    blob = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(blob)
    return len(blob)


def make(size):
    """一只碗 + 一堆饭。够简单才在 48px 下还认得出来。

    ⚠️ 不留圆角、不留透明边:iOS 会自己切圆角,Android 用 maskable
       也要求四周有安全边距 —— 所以图形本身缩在中间 80% 里。
    """
    c = size / 2.0
    r_bowl = size * 0.34
    r_rice = size * 0.30
    rim_y = size * 0.46          # 碗口那条线
    rim_h = max(1.0, size * 0.035)

    def px(x, y):
        dx, dy = x + 0.5 - c, y + 0.5 - c
        d = (dx * dx + dy * dy) ** 0.5
        # 碗口那道横杠(比碗略宽,看着像个碗沿)
        if abs(y + 0.5 - rim_y) <= rim_h and abs(dx) <= r_bowl * 1.12:
            return BOWL
        # 碗:半圆,只取碗沿以下
        if d <= r_bowl and y + 0.5 > rim_y:
            return BOWL
        # 饭:半圆,只取碗沿以上
        if d <= r_rice and y + 0.5 < rim_y:
            return RICE
        return ACCENT

    return px


if __name__ == '__main__':
    for name, size in [('icon-192.png', 192), ('icon-512.png', 512),
                       ('apple-touch-icon.png', 180)]:
        p = os.path.join(APP, name)
        n = png(p, size, make(size))
        print('%-22s %d x %d  %d bytes' % (name, size, size, n))
