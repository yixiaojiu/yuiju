---
name: mapillary
description: "当用户需要街景图片、全景图，或希望通过 Mapillary 的街景照片探索某个地点时使用。自动下载图片到 /opt/hermes/data/img/，调用 SiliconFlow vision 模型（baseUrl: https://api.siliconflow.cn/v1，model: Qwen/Qwen3.5-397B-A17B）获取图片描述，用文字返回结果。**禁止 Hermes 使用自带的 vision_analyze 工具，必须使用 skill 内置的 SiliconFlow vision 模型识别图片并返回描述,返回的描述里不需要指南针方位等信息**"
version: 1.0.0
author: ywxx252324
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Mapillary, street view, panorama, street-level, location, explore]
    category: productivity
    related_skills: [maps]
    requires_toolsets: [terminal]
---

# Mapillary — 街景探索

通过 Mapillary API 获取街景图片和全景图像。用户输入地点名称或坐标，返回该位置的街景照片，支持按序列浏览多条连续的街景路径。

**前提：** Mapillary API key 和 SiliconFlow API key 已硬编码在脚本中。

```bash
# 运行示例
python3 /opt/data/skills/mapillary/scripts/mapillary_client.py search 39.907359 116.391263
# 应返回天安门附近的街景 ID 列表
```

## 快速使用

```bash
MAP="python3 /opt/data/skills/mapillary/scripts/mapillary_client.py"
```

## 命令说明

### search — 通过坐标搜索街景

```bash
# 直接输入坐标（纬度 经度）
$MAP search 39.907359 116.391263
$MAP search 48.8584 2.2945 --limit 5
```

### search-address — 通过地址搜索（自动 geocode）

```bash
# 自动将地址转为坐标并搜索附近街景，下载图片并获取描述
$MAP search-address "天安门"
$MAP search-address "Eiffel Tower"
```

**返回逻辑：**
- 1 个搜索结果：返回该序列前 9 张图片详情
- 3 个及以上结果：随机抽取 3 个 ID，查各自序列，每序列随机抽 3 张（共最多 9 张）

### image — 获取单张图片详情

```bash
$MAP image <image_id>
```

### sequence — 获取同序列所有图片

```bash
$MAP sequence <image_id>
```

输入任意图片 ID，自动获取其所属序列，返回该序列前 9 张图片的完整详情。

## 输出格式

### search 返回

```json
{
  "pano_ids": ["482584256364804", "123456789012345", ...]
}
```

### search-address 返回

```json
{
  "images": [
    {
      "id": "...",
      "captured_at": "...",
      "compass_angle": 45.2,
      "is_pano": true,
      "thumb_1024_url": "https://...",
      "local_path": "/opt/hermes/data/img/1.jpg",
      "description": "这是一条繁华的商业街，两侧是现代化的写字楼...",
      "sequence": "0HXSH2hA0apL7DrQA-Yvpw",
      "creator": "...",
      "mapillary_url": "https://www.mapillary.com/image/..."
    }
  ],
  "count": 9
}
```

### image 返回

```json
{
  "id": "482584256364804",
  "captured_at": "2024-03-15T10:30:00Z",
  "compass_angle": 45.2,
  "is_pano": true,
  "thumb_1024_url": "https://...",
  "sequence": "0HXSH2hA0apL7DrQA-Yvpw",
  "creator": "username",
  "mapillary_url": "https://www.mapillary.com/image/482584256364804"
}
```

### sequence 返回

```json
{
  "sequence_id": "0HXSH2hA0apL7DrQA-Yvpw",
  "images": [
    {
      "id": "...",
      "captured_at": "...",
      "compass_angle": 45.2,
      "is_pano": true,
      "thumb_1024_url": "https://...",
      "sequence": "0HXSH2hA0apL7DrQA-Yvpw",
      "creator": "..."
    }
  ]
}
```

## 命令参考

| 命令 | 说明 |
|------|------|
| `search <lat> <lon>` | 通过坐标搜索全景图 ID |
| `search-address <地址>` | 通过地址搜索（自动 geocode） |
| `image <image_id>` | 获取单张图片详情 |
| `sequence <image_id>` | 获取同序列所有图片（前 9 张） |

## 注意事项

- **频率限制**：Nominatim（geocode）有 1 req/s 限制，脚本已内置 sleep
- **序列数量**：sequence 接口最多返回 9 张图片
- **全景优先**：search 默认只返回 `is_pano=true` 的全景图

## 常见问题

1. **无结果** — 该位置可能没有 Mapillary 街景覆盖
2. **Nominatim 超时** — 检查网络，geocode 有 10s 超时
3. **SiliconFlow 超时** — WSL 环境下访问 api.siliconflow.cn 可能 TLS 超时，需要通过 Windows 侧中转

## 相关

- `maps` skill — OpenStreetMap 数据，用于地理编码和 POI 搜索（无街景）