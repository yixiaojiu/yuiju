
"""
mapillary_client.py - Mapillary 街景 CLI 工具
使用 Python 标准库，通过 Mapillary API 获取街景图片和全景图像。
图片下载到本地后调用 SiliconFlow vision 模型获取文字描述。

用法：
    python3 mapillary_client.py search <lat> <lon>
    python3 mapillary_client.py search-address "天安门"
    python3 mapillary_client.py image <image_id>
    python3 mapillary_client.py sequence <image_id>
"""

import argparse
import base64
import json
import os
import random
import sys
import urllib.error
import urllib.parse
import urllib.request

# ---------------------------------------------------------------------------
# API 配置（硬编码，来源：SKILL.md）
# ---------------------------------------------------------------------------
MAPILLARY_API_KEY = "MLY|26914509934909830|055828110aa28071ce11a177eefacf69"
SILICONFLOW_API_KEY = "sk-ejilawamjgevnbvbxttlvikyffetxotvcluxcxswcmtyfvhl"
SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1"
SILICONFLOW_MODEL = "Qwen/Qwen3.5-397B-A17B"


# ---------------------------------------------------------------------------
# Vision 模块：调用 SiliconFlow vision API 获取图片描述
# ---------------------------------------------------------------------------

class VisionModel:
    """读取本地图片，调用 SiliconFlow vision API 返回文字描述。"""

    def __init__(self):
        self.api_key = SILICONFLOW_API_KEY
        self.base_url = SILICONFLOW_BASE_URL
        self.model = SILICONFLOW_MODEL
        print(f"[VISION] Using model: {self.model}")

    def describe(self, image_path: str, retries: int = 3) -> str:
        """将本地图片转为 base64 data URI，发给 SiliconFlow vision 模型。
        失败时自动重试最多 retries 次（每次间隔 2 秒）。"""
        if not self.api_key or not self.base_url or not self.model:
            return "[vision config missing]"

        if not os.path.exists(image_path):
            return "[image not found]"

        # 读取图片并转为 data URI
        with open(image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()
        data_uri = f"data:image/jpeg;base64,{img_b64}"

        # 构建 vision API 请求体
        payload = {
            "model": self.model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_uri, "detail": "high"}},
                    {"type": "text", "text": "请描述这张图片的内容，控制在 100 字以内。"}
                ]
            }]
        }

        data = json.dumps(payload).encode("utf-8")
        last_error = ""
        for attempt in range(1, retries + 1):
            try:
                req = urllib.request.Request(
                    f"{self.base_url}/chat/completions",
                    data=data,
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self.api_key}",
                    },
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=60) as r:
                    response = json.loads(r.read())
                content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
                print(f"[VISION] Got description: {content[:50]}...")
                return content
            except Exception as e:
                last_error = str(e)
                print(f"[VISION] Attempt {attempt}/{retries} failed: {e}")
                if attempt < retries:
                    import time
                    time.sleep(2)

        return f"[vision error after {retries} retries: {last_error}]"


# ---------------------------------------------------------------------------
# Mapillary API Client
# ---------------------------------------------------------------------------

class MapillaryApiClient:
    """Mapillary API v4 客户端，封装街景图片搜索、下载等操作。"""

    BASE_URL = "https://graph.mapillary.com"

    def __init__(self, api_key: str):
        self.api_key = api_key

    def _get(self, endpoint: str, params: dict = None) -> dict:
        """向 Mapillary API 发起 GET 请求。"""
        url = f"{self.BASE_URL}{endpoint}"
        params = dict(params) if params else {}
        params["access_token"] = self.api_key
        query = urllib.parse.urlencode(params)
        full_url = f"{url}?{query}"
        req = urllib.request.Request(full_url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())

    def locationToImageID(self, lat: float = 39.907359, lng: float = 116.391263,
                          limit: int = 5, radius: int = 50) -> dict:
        """搜索指定坐标附近的街景图片 ID（仅返回全景图）。
        参数：
            lat/lng: 搜索中心坐标
            limit: 返回数量上限
            radius: 搜索半径（米）
        返回：{"pano_ids": [image_id, ...]}"""
        data = self._get("/images", {
            "lat": lat,
            "lng": lng,
            "radius": radius,
            "limit": limit,
            "is_pano": True,
            "fields": "id",
        })
        image_ids = [img.get("id", "") for img in data.get("data", []) if img.get("id")]
        return {"pano_ids": image_ids}

    def geocode_address(self, query: str) -> dict:
        """将地址名称转为经纬度坐标（使用 OpenStreetMap Nominatim）。
        返回：{"lat": float, "lon": float, "display_name": str} 或 {"error": str}"""
        import time
        time.sleep(1)  # Nominatim 要求每秒最多 1 次请求
        params = urllib.parse.urlencode({"q": query, "format": "json"})
        url = f"https://nominatim.openstreetmap.org/search?{params}"
        req = urllib.request.Request(url, headers={"User-Agent": "HermesAgent/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            results = json.loads(r.read())
        if not results:
            return {"error": "Address not found", "query": query}
        first = results[0]
        return {
            "lat": float(first.get("lat", 0)),
            "lon": float(first.get("lon", 0)),
            "display_name": first.get("display_name", ""),
        }

    def search_by_address(self, address: str, limit: int = 5, radius: int = 50) -> dict:
        """通过地址搜索附近街景，返回图片列表及描述。
        流程：geocode → 搜索附近全景 → 获取序列图片 → 下载 → 调用 vision API。
        返回逻辑：
            1 个结果 → 返回该序列前 9 张图片
            3+ 结果 → 随机选 3 个 ID，各取 3 张（共最多 9 张）"""
        vision_model = VisionModel()

        # 地址转坐标
        geo = self.geocode_address(address)
        if "error" in geo:
            return geo

        lat, lng = geo["lat"], geo["lon"]
        # 以坐标为中心向 5 个方向扩散搜索，提高找到街景的概率
        offsets = [
            (0, 0),
            (0.0004, 0.0004),
            (-0.0004, 0.0004),
            (0.0004, -0.0004),
            (-0.0004, -0.0004),
        ]

        # 收集所有方向的搜索结果
        all_ids = []
        for dlat, dlng in offsets:
            try:
                result = self.locationToImageID(lat + dlat, lng + dlng, limit=limit, radius=radius)
                pano_ids = result.get("pano_ids", [])
                if pano_ids:
                    all_ids.append(pano_ids[0])
            except Exception:
                continue

        # 去重
        seen, unique_ids = set(), []
        for pid in all_ids:
            if pid not in seen:
                seen.add(pid)
                unique_ids.append(pid)

        if not unique_ids:
            return {"error": "No panoramas found near this address", "query": address}

        # 只有 1 个唯一 ID 时直接返回该序列全部图片
        if len(unique_ids) == 1:
            return self.get_sequence_image_ids(unique_ids[0], vision_model)

        # 多个 ID 时随机选取，每序列取 3 张
        selected_ids = random.sample(unique_ids, min(3, len(unique_ids)))
        all_images = []
        seen_sequences = set()
        for img_id in selected_ids:
            seq_result = self.get_sequence_image_ids(img_id, vision_model)
            if "error" in seq_result or not seq_result.get("images"):
                continue
            seq_id = seq_result.get("sequence_id", "")
            if seq_id in seen_sequences:
                continue
            seen_sequences.add(seq_id)
            images = seq_result["images"]
            sampled = random.sample(images, min(3, len(images)))
            all_images.extend(sampled)

        if not all_images:
            return {"error": "No sequence images found", "query": address}
        return {"images": all_images, "count": len(all_images)}

    def get_image_detail(self, image_id: str) -> dict:
        """获取单张图片的完整元数据。"""
        return self._get(f"/{image_id}", {
            "fields": "id,captured_at,compass_angle,is_pano,thumb_1024_url,sequence,creator",
        })

    def get_sequence_image_ids(self, image_id: str, vision_model: VisionModel = None) -> dict:
        """根据任意一张图片 ID，找到其所属序列，返回序列中前 9 张图片的详情。
        图片会下载到 /opt/hermes/data/img/，并调用 vision_model 获取描述。"""
        # 找到图片所属的序列 ID
        image_data = self._get(f"/{image_id}", {"fields": "sequence"})
        seq_id = image_data.get("sequence", "")
        if not seq_id:
            return {"error": "No sequence found for this image", "image_id": image_id}

        # 获取序列中所有图片 ID
        seq_data = self._get("/image_ids", {"sequence_id": seq_id, "fields": "id"})
        image_ids = [img.get("id", "") for img in seq_data.get("data", []) if img.get("id")]
        if not image_ids:
            return {"sequence_id": seq_id, "images": []}

        image_ids = image_ids[:9]  # 最多取 9 张

        # 获取每张图片的详细信息并下载
        images = []
        for i, img_id in enumerate(image_ids):
            detail = self._get(f"/{img_id}", {
                "fields": "id,captured_at,compass_angle,is_pano,thumb_1024_url,sequence,creator",
            })
            thumb_url = detail.get("thumb_1024_url", "")
            if thumb_url:
                local_path = self._download_image(thumb_url, f"{i+1}.jpg")
                detail["local_path"] = local_path
                if vision_model and local_path:
                    detail["description"] = vision_model.describe(local_path)
            images.append(detail)

        return {"sequence_id": seq_id, "images": images}

    def _download_image(self, url: str, filename: str) -> str:
        """下载图片到 /opt/hermes/data/img/，返回本地路径。"""
        tmp_dir = "/opt/hermes/data/img"
        os.makedirs(tmp_dir, exist_ok=True)
        local_path = os.path.join(tmp_dir, filename)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "HermesAgent/1.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                with open(local_path, "wb") as f:
                    f.write(r.read())
            return local_path
        except Exception as e:
            return ""


# ---------------------------------------------------------------------------
# CLI 入口
# ---------------------------------------------------------------------------

def cmd_search(args) -> None:
    """search 子命令：通过坐标搜索街景 ID 列表。"""
    client = MapillaryApiClient(MAPILLARY_API_KEY)
    data = client.locationToImageID(lat=args.lat, lng=args.lon, limit=args.limit)
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_image(args) -> None:
    """image 子命令：获取单张图片的完整详情。"""
    client = MapillaryApiClient(MAPILLARY_API_KEY)
    data = client.get_image_detail(args.image_id)
    if "error" in data:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        sys.exit(1)
    output = {
        "id": data.get("id", ""),
        "captured_at": data.get("captured_at", ""),
        "compass_angle": data.get("compass_angle", None),
        "is_pano": data.get("is_pano", False),
        "thumb_1024_url": data.get("thumb_1024_url", ""),
        "sequence": data.get("sequence", ""),
        "creator": data.get("creator", ""),
        "mapillary_url": f"https://www.mapillary.com/image/{data.get('id', '')}",
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Mapillary 街景 CLI")
    sub = parser.add_subparsers(dest="command")

    # search <lat> <lon> [--limit N]
    search_parser = sub.add_parser("search", help="通过坐标搜索街景 ID（仅全景）")
    search_parser.add_argument("lat", type=float, help="纬度")
    search_parser.add_argument("lon", type=float, help="经度")
    search_parser.add_argument("--limit", type=int, default=5, help="最大返回数量（默认 5）")

    # search-address <地址> [--limit N]
    addr_parser = sub.add_parser("search-address", help="通过地址搜索街景（自动 geocode）")
    addr_parser.add_argument("address", help="地址名称")
    addr_parser.add_argument("--limit", type=int, default=5, help="最大返回数量（默认 5）")

    # image <image_id>
    img_parser = sub.add_parser("image", help="获取单张图片详情")
    img_parser.add_argument("image_id", help="Mapillary 图片 ID")

    # sequence <image_id>
    seq_parser = sub.add_parser("sequence", help="获取同序列所有图片（前 9 张）")
    seq_parser.add_argument("image_id", help="任意一张图片 ID（自动找所属序列）")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(0)

    if args.command == "search":
        cmd_search(args)
    elif args.command == "search-address":
        client = MapillaryApiClient(MAPILLARY_API_KEY)
        data = client.search_by_address(args.address, limit=args.limit)
        print(json.dumps(data, ensure_ascii=False, indent=2))
    elif args.command == "image":
        cmd_image(args)
    elif args.command == "sequence":
        client = MapillaryApiClient(MAPILLARY_API_KEY)
        data = client.get_sequence_image_ids(args.image_id)
        print(json.dumps(data, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()